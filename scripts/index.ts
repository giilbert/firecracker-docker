import chalk from "chalk";
import * as path from "node:path";

const EXPORT_DIR = "/tmp/docker-rootfs-export";
const REPO_ROOT = `${import.meta.dir}/..`;
const ARTIFACTS_DIR = path.resolve(`${process.cwd()}/artifacts`);

const err = (message: string | unknown, ...rest: unknown[]) => {
  if (rest.length > 0) console.error(chalk.red(`error ${message}`), ...rest);
  else console.error(chalk.red(`error ${message}`));
};

const info = (...rest: unknown[]) => {
  console.log(chalk.blue(`info`), ...rest);
};

const dockerfilePath = process.argv[2];
if (!dockerfilePath) {
  err("please provide the path to the Dockerfile as an argument.");
  process.exit(0);
}

async function extractRootfs(dockerfilePath: string) {
  info("building the Dockerfile at", chalk.yellow(dockerfilePath));

  let lineBuffer = "";
  const buildCmd = [
    "docker",
    "build",
    "-t",
    "firecracker-docker-image-tmp",
    "-f",
    dockerfilePath,
    "--progress",
    "plain",
    ".",
  ];

  const handleDockerOutput = (_terminal: Bun.Terminal, data: Uint8Array) => {
    const text = data.toString();
    lineBuffer += text;

    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() || "";

    for (const line of lines) console.log(chalk.gray(`docker: ${line}`));
  };

  // create the rootfs image using docker build
  info(`creating docker image:`, chalk.yellow(buildCmd.join(" ")));
  const buildP = Bun.spawn(buildCmd, {
    terminal: { data: handleDockerOutput },
  });

  await buildP.exited;
  if (buildP.exitCode !== 0) {
    err(`docker build failed with exit code ${buildP.exitCode}`);
    process.exit(0);
  }
  lineBuffer = "";

  // create a container from the image to export the rootfs
  info("spawning temporary container to export rootfs");
  const tempContainerId =
    await Bun.$`docker create --rm firecracker-docker-image-tmp`.text();
  info("temporary container id:", tempContainerId.trim().substring(0, 12));

  await Bun.$`rm -rf ${EXPORT_DIR}`.quiet();

  // export the rootfs from the container
  const exportCmd = ["docker", "cp", `${tempContainerId.trim()}:/`, EXPORT_DIR];
  info(
    "exporting rootfs from temporary container:",
    chalk.yellow(exportCmd.join(" ")),
  );
  const exportP = Bun.spawn(exportCmd, {
    terminal: { data: handleDockerOutput },
  });

  await exportP.exited;
  if (exportP.exitCode !== 0) {
    err(`docker cp failed with exit code ${exportP.exitCode}`);
    process.exit(0);
  }

  // clean up the temporary container after we're done
  const rm = await Bun.$`docker rm ${tempContainerId.trim()}`.quiet();
  if (rm.exitCode === 0) info("cleaned up temporary container");
  else err("failed to remove temporary container", rm.stderr.toString());
}

async function getVmlinuxAndInitrd(root: string) {
  const BOOT_DIR = `${root}/boot`;
  const OUTPUT_DIR = path.resolve(`${process.cwd()}/artifacts`);
  const initrdSrc = path.resolve(`${BOOT_DIR}/initrd.img`);
  const vmlinuzSrc = path.resolve(`${BOOT_DIR}/vmlinuz`);
  const initrdOut = path.resolve(`${OUTPUT_DIR}/initrd.img`);

  const vmlinuxOut = `${OUTPUT_DIR}/vmlinux`;
  const tmpVmlinuz = "/tmp/firecracker-vmlinuz";
  const extractScript = `${REPO_ROOT}/utils/extract-vmlinux`;

  info("extracting boot artifacts from", chalk.yellow(BOOT_DIR));

  // try to find the initrd and vmlinuz files in the exported rootfs
  if (!(await Bun.file(initrdSrc).exists())) {
    err(`initrd not found at ${initrdSrc}`);
    process.exit(0);
  }

  if (!(await Bun.file(vmlinuzSrc).exists())) {
    err(`vmlinuz not found at ${vmlinuzSrc}`);
    process.exit(0);
  }

  await Bun.$`mkdir -p ${OUTPUT_DIR}`.quiet();

  // dereference symlinks so outputs are regular files.
  const cpInitrd = await Bun.$`cp -L ${initrdSrc} ${initrdOut}`.quiet();
  if (cpInitrd.exitCode !== 0) {
    err("failed to copy initrd", cpInitrd.stderr.toString());
    process.exit(0);
  }

  const cpVmlinuz = await Bun.$`cp -L ${vmlinuzSrc} ${tmpVmlinuz}`.quiet();
  if (cpVmlinuz.exitCode !== 0) {
    err("failed to copy vmlinuz", cpVmlinuz.stderr.toString());
    process.exit(0);
  }

  // run extract-vmlinux and capture binary stdout directly.
  const extract = await Bun.$`${extractScript} ${tmpVmlinuz}`.quiet();
  if (extract.exitCode !== 0) {
    err("failed to extract vmlinux", extract.stderr.toString().trim());
    process.exit(0);
  }

  if (extract.stdout.byteLength === 0) {
    err("failed to extract vmlinux", "extract-vmlinux returned empty output");
    process.exit(0);
  }

  // copy the extracted vmlinux to the output directory
  await Bun.write(vmlinuxOut, extract.stdout);

  const vmlinuxFileType = await Bun.$`file -b ${vmlinuxOut}`.text();
  if (!vmlinuxFileType.toLowerCase().includes("elf")) {
    err("extracted vmlinux is not ELF", vmlinuxFileType.trim());
    process.exit(0);
  }

  await Bun.$`rm -f ${tmpVmlinuz}`.quiet();
  info("wrote", chalk.yellow(initrdOut));
  info("wrote", chalk.yellow(vmlinuxOut));
}

async function createRawRootImage(root: string) {
  const rawOut = path.resolve(`${ARTIFACTS_DIR}/rootfs.raw`);

  await Bun.$`mkdir -p ${ARTIFACTS_DIR}`.quiet();

  const duOut = await Bun.$`du -s --apparent-size -B1 ${root}`.text();
  const apparentBytes = Number(duOut.trim().split(/\s+/)[0]);
  if (!Number.isFinite(apparentBytes) || apparentBytes <= 0) {
    err("failed to determine exported rootfs size", duOut.trim());
    process.exit(0);
  }

  // add headroom for filesystem metadata/journal and copied file growth.
  let IMAGE_SIZE = 4 * 1024 * 1024 * 1024; // start with 1.5 GiB

  info("creating raw root image:", chalk.yellow(rawOut));

  // since we dont know exactly how much space mke2fs will need for metadata/journal allocation and
  // file copying, we implement a retry loop that increases the image size if mke2fs fails due to
  // insufficient space.
  const blocks = Math.ceil(IMAGE_SIZE / 4096);

  await Bun.$`rm -f ${rawOut}`.quiet();
  const mkfsP = Bun.spawn(
    ["mke2fs", "-t", "ext4", "-d", root, "-F", rawOut, String(blocks)],
    { stdout: "pipe", stderr: "pipe" },
  );

  const mkfsStdout = await new Response(mkfsP.stdout).text();
  const mkfsStderr = await new Response(mkfsP.stderr).text();
  await mkfsP.exited;

  if (mkfsP.exitCode !== 0) {
    err(
      "mke2fs failed with exit code\n",
      mkfsP.exitCode,
      "stdout:",
      mkfsStdout.trim(),
      "stderr:",
      mkfsStderr.trim(),
    );
    process.exit(0);
  }

  const rawType = await Bun.$`file -b ${rawOut}`.text();
  if (!rawType.toLowerCase().includes("ext4")) {
    err("created root image is not ext4", rawType.trim());
    process.exit(0);
  }

  info("wrote", chalk.yellow(rawOut));
}

async function createDataImage() {
  const dataOut = path.resolve(`${ARTIFACTS_DIR}/data.raw`);

  await Bun.$`mkdir -p ${ARTIFACTS_DIR}`.quiet();

  // create an empty 256 MiB ext4 image for the data drive
  const IMAGE_SIZE = 256 * 1024 * 1024;
  const blocks = Math.ceil(IMAGE_SIZE / 4096);

  info("creating empty data image:", chalk.yellow(dataOut));

  await Bun.$`rm -f ${dataOut}`.quiet();
  const mkfsP = Bun.spawn(
    ["mke2fs", "-t", "ext4", "-F", dataOut, String(blocks)],
    { stdout: "pipe", stderr: "pipe" },
  );

  const mkfsStdout = await new Response(mkfsP.stdout).text();
  const mkfsStderr = await new Response(mkfsP.stderr).text();
  await mkfsP.exited;

  if (mkfsP.exitCode !== 0) {
    err(
      "mke2fs failed with exit code\n",
      mkfsP.exitCode,
      "stdout:",
      mkfsStdout.trim(),
      "stderr:",
      mkfsStderr.trim(),
    );
    process.exit(0);
  }

  const dataType = await Bun.$`file -b ${dataOut}`.text();
  if (!dataType.toLowerCase().includes("ext4")) {
    err("created data image is not ext4", dataType.trim());
    process.exit(0);
  }

  info("wrote", chalk.yellow(dataOut));
}

await extractRootfs(dockerfilePath);
await getVmlinuxAndInitrd(EXPORT_DIR);
await createRawRootImage(EXPORT_DIR);
await createDataImage();

info("done! artifacts written to", chalk.yellow(ARTIFACTS_DIR));
