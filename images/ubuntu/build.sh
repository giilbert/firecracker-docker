#!/bin/bash

set -e

echo_dim () {
    echo -e "\033[2m$1\033[0m"
}

# check if ubuntu.raw already exists, if so, skip the build
if ! [[ -f "ubuntu.raw" ]]; then
    d2vm build \
        -o ubuntu.raw \
        -s 400M \
        --force -v .
else
    echo_dim "ubuntu.raw already exists, skipping d2vm build"
fi

# make the data overlay filesystem
dd if=/dev/zero of=data.raw bs=1M count=512
mkfs.ext4 data.raw
echo "formatted data.raw as ext4"

# take out vmlinux and initrd.img from the raw image
SECTOR_START=$(fdisk -l ./ubuntu.raw | awk '/ubuntu.raw1/{print $3}')
SECTOR_SIZE=512
OFFSET=$((SECTOR_START * SECTOR_SIZE))

# hack to remove systemd services which causes weird errors
remove_services=(
    "systemd-tpm2-setup-early.service"
    "systemd-tpm2-setup.service"
    "systemd-pstore.service"
    "systemd-binfmt.service"
    "systemd-fsck-root.service"
    "systemd-fsckd.service"
    "apt-daily.timer"
    "apt-daily-upgrade.timer"
    "dpkg-db-backup.timer"
    "motd-news.timer"
    "e2scrub_all.timer"
    "fstrim.timer"
    "systemd-sysupdate.timer"
    "systemd-sysupdate-reboot.timer"
)
for service in "${remove_services[@]}"; do
    debugfs -w -f <(echo "rm /usr/lib/systemd/system/${service}") "ubuntu.raw?offset=${OFFSET}" 2>/dev/null \
        || echo "[setup] skipped $service"
done

e2cp "ubuntu.raw?offset=${OFFSET}:/boot/initrd.img" /tmp/initrd.img
echo "copied initrd.img"

# patch initrd.img
rm -rf /tmp/initrd && mkdir /tmp/initrd
unmkinitramfs /tmp/initrd.img /tmp/initrd

# find correct path
INIT_BOTTOM=$(find /tmp/initrd -name "init-bottom" -type d)
echo "init-bottom at: $INIT_BOTTOM"
sed -i '1s|^|/scripts/init-bottom/overlay "$@"\n|' "$INIT_BOTTOM/ORDER"
cp ./overlay "$INIT_BOTTOM/overlay"
chmod +x "$INIT_BOTTOM/overlay"

e2ls "ubuntu.raw?offset=${OFFSET}:/usr/lib/modules"
# extract overlay module from the guest image
GUEST_KERNEL=$(e2ls "ubuntu.raw?offset=${OFFSET}:/usr/lib/modules" | tr -d ' ')
echo "guest kernel: $GUEST_KERNEL"
# get the exact filename
OVERLAY_FILE=$(e2ls "ubuntu.raw?offset=${OFFSET}:/usr/lib/modules/${GUEST_KERNEL}/kernel/fs/overlayfs" | tr -d ' ')
echo "overlay file: $OVERLAY_FILE"
e2cp "ubuntu.raw?offset=${OFFSET}:/usr/lib/modules/${GUEST_KERNEL}/kernel/fs/overlayfs/${OVERLAY_FILE}" /tmp/${OVERLAY_FILE}

rm -rf /tmp/overlay.ko 
# decompress if zst
if [[ "$OVERLAY_FILE" == *.zst ]]; then
    zstd -d /tmp/${OVERLAY_FILE} -o /tmp/overlay.ko
else
    cp /tmp/${OVERLAY_FILE} /tmp/overlay.ko
fi

# copy into initrd
mkdir -p "/tmp/initrd/main/usr/lib/modules/${GUEST_KERNEL}/kernel/fs/overlayfs/"
cp /tmp/overlay.ko "/tmp/initrd/main/usr/lib/modules/${GUEST_KERNEL}/kernel/fs/overlayfs/overlay.ko"

# repack
{
    for dir in /tmp/initrd/early*; do
        [ -d "$dir" ] && (cd "$dir" && find . | cpio -o -H newc 2>/dev/null)
    done
    (cd /tmp/initrd/main && find . | cpio -o -H newc 2>/dev/null | zstd -z)
} > initrd.img

echo "patched initrd.img"

e2cp "ubuntu.raw?offset=${OFFSET}:/boot/vmlinuz" /tmp/vmlinuz
echo "copied vmlinuz"

echo "extracting vmlinux from vmlinuz.."
../../utils/extract-vmlinux /tmp/vmlinuz > ./vmlinux
echo "extracted vmlinux"

file ./vmlinux