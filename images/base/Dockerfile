FROM ubuntu:24.04 AS rootfs

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    e2fsprogs \
    initramfs-tools \
    util-linux \
    linux-image-generic \
    kmod \
    sudo \
    systemd-sysv

# keep systemd/journald quiet on serial console for microvm boots
RUN mkdir -p /etc/systemd/system.conf.d /etc/systemd/journald.conf.d && \
    cat <<'EOF' > /etc/systemd/system.conf.d/10-quiet.conf
[Manager]
ShowStatus=no
LogLevel=emerg
EOF

RUN cat <<'EOF' > /etc/systemd/journald.conf.d/10-quiet.conf
[Journal]
ForwardToConsole=no
MaxLevelConsole=emerg
EOF

# install the overlay setup script into initramfs so /dev/vda stays read-only
# and /dev/vdb provides the writable upper/work directories.
COPY ./setup-overlay.sh /etc/initramfs-tools/scripts/local-bottom/overlay

RUN chmod +x /etc/initramfs-tools/scripts/local-bottom/overlay && \
    printf 'overlay\n' > /etc/initramfs-tools/modules && \
    mkdir -p /etc/initramfs-tools/hooks && \
    cat <<'EOF' > /etc/initramfs-tools/hooks/overlay-tools
#!/bin/sh
set -e

PREREQ=""
prereqs() {
    echo "$PREREQ"
}

case "$1" in
    prereqs)
        prereqs
        exit 0
        ;;
esac

. /usr/share/initramfs-tools/hook-functions

copy_exec /usr/sbin/blkid /usr/sbin
copy_exec /usr/sbin/mkfs.ext4 /usr/sbin
copy_exec /usr/bin/ls /usr/bin
copy_exec /usr/bin/dirname /usr/bin
copy_exec /usr/bin/readlink /usr/bin
EOF

RUN chmod +x /etc/initramfs-tools/hooks/overlay-tools

# set up initramfs
RUN KERNEL_VERSION="$(ls -1 /lib/modules | sort -V | tail -n1)" && \
    update-initramfs -c -k "${KERNEL_VERSION}" && \
    test -e /sbin/init && \
    test -e /boot/initrd.img && \
    test -e /boot/vmlinuz && \
    rm -rf /var/lib/apt/lists/*

# create user and auto login to serial console
RUN useradd -m -s /bin/bash guest && echo "guest:password" | chpasswd && \
    chmod 0755 /home/guest && \
    mkdir -p /etc/systemd/system/serial-getty@ttyS0.service.d/ && \
    cat <<'EOF' > /etc/systemd/system/serial-getty@ttyS0.service.d/override.conf
[Service]
ExecStartPre=/bin/sh -ec '[ -e /etc/sudo.conf ] && { chown root:root /etc/sudo.conf; chmod 0644 /etc/sudo.conf; } || true; [ -e /etc/sudoers ] && { chown root:root /etc/sudoers; chmod 0440 /etc/sudoers; } || true; [ -d /etc/sudoers.d ] && { chown root:root /etc/sudoers.d; chmod 0755 /etc/sudoers.d; chown -R root:root /etc/sudoers.d; find /etc/sudoers.d -type f -exec chmod 0440 {} +; } || true; [ -e /usr/bin/sudo ] && { chown root:root /usr/bin/sudo; chmod 4755 /usr/bin/sudo; } || true'
ExecStart=
ExecStart=-/sbin/agetty --keep-baud 115200,57600,38400,9600 --autologin guest --noclear %I $TERM
Type=idle
EOF
RUN \
    mkdir -p /etc/systemd/system/getty.target.wants && \
    ln -sf /lib/systemd/system/serial-getty@.service /etc/systemd/system/getty.target.wants/serial-getty@ttyS0.service && \
    if [ -f /etc/inittab ]; then \
    sed -i '/ttyS0/d' /etc/inittab && \
    printf 'T0:23:respawn:/sbin/agetty -L --autologin guest -8 115200 ttyS0 vt220\n' >> /etc/inittab; \
    fi && \
    passwd -d guest

# TODO: comment me out
# add guest to sudoers
RUN echo "guest ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    usermod -aG sudo guest

# allow guest to run /sbin/reboot without password
RUN echo "guest ALL=(ALL) NOPASSWD:/sbin/reboot" >> /etc/sudoers && \
    echo "sudo -n /sbin/reboot -f >/dev/null 2>&1 || true" >> /home/guest/.bash_logout && \
    echo "#!/bin/bash\nsudo /sbin/reboot -f" > /usr/bin/stop-guest && chmod +x /usr/bin/stop-guest && \
    chown guest:guest /home/guest /home/guest/.bash_logout

# fix guest home ownership at boot in case persisted overlay metadata has stale UID/GID
RUN cat <<'EOF' > /etc/systemd/system/fix-guest-home.service
[Unit]
Description=Fix ownership and mode for /home/guest
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/bin/sh -ec 'if [ -L /home/guest ]; then rm -f /home/guest; fi; mkdir -p /home/guest; chown -R guest:guest /home/guest; chmod 0755 /home/guest'

[Install]
WantedBy=multi-user.target
EOF

# repair sudo ownership/permissions at boot in case persistent overlay metadata corrupted root-owned files
RUN cat <<'EOF' > /etc/systemd/system/fix-sudo-perms.service
[Unit]
Description=Repair sudo file ownership and permissions
After=local-fs.target
Before=getty.target serial-getty@ttyS0.service

[Service]
Type=oneshot
ExecStart=/bin/sh -ec '
    [ -e /etc/sudo.conf ] && { chown root:root /etc/sudo.conf; chmod 0644 /etc/sudo.conf; } || true
    [ -e /etc/sudoers ] && { chown root:root /etc/sudoers; chmod 0440 /etc/sudoers; } || true
    [ -d /etc/sudoers.d ] && { chown root:root /etc/sudoers.d; chmod 0755 /etc/sudoers.d; chown -R root:root /etc/sudoers.d; find /etc/sudoers.d -type f -exec chmod 0440 {} +; } || true
    [ -e /usr/bin/sudo ] && { chown root:root /usr/bin/sudo; chmod 4755 /usr/bin/sudo; } || true
'

[Install]
WantedBy=multi-user.target
EOF

# repair localhost resolution for sudo by ensuring hosts entries exist for localhost and current hostname
RUN cat <<'EOF' > /etc/systemd/system/fix-hosts.service
[Unit]
Description=Repair localhost hostname resolution
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/bin/sh -ec 'h=$(cat /etc/hostname 2>/dev/null || hostname); grep -q "127.0.0.1 localhost" /etc/hosts || echo "127.0.0.1 localhost" >> /etc/hosts; grep -q "127.0.1.1 $h" /etc/hosts || echo "127.0.1.1 $h" >> /etc/hosts'

[Install]
WantedBy=multi-user.target
EOF

RUN mkdir -p /etc/systemd/system/multi-user.target.wants && \
    ln -sf /etc/systemd/system/fix-guest-home.service /etc/systemd/system/multi-user.target.wants/fix-guest-home.service && \
    ln -sf /etc/systemd/system/fix-sudo-perms.service /etc/systemd/system/multi-user.target.wants/fix-sudo-perms.service && \
    ln -sf /etc/systemd/system/fix-hosts.service /etc/systemd/system/multi-user.target.wants/fix-hosts.service

# non-systemd fallback: run startup repairs and keep ttyS0 autologin via sysvinit
RUN cat <<'EOF' > /etc/rc.local
#!/bin/sh
set +e

# fallback autologin for non-systemd boots only: avoid conflicting with serial-getty@ttyS0
if [ "$(cat /proc/1/comm 2>/dev/null)" != "systemd" ]; then
    h=$(cat /etc/hostname 2>/dev/null || hostname)
    grep -q "127.0.0.1 localhost" /etc/hosts || echo "127.0.0.1 localhost" >> /etc/hosts
    grep -q "127.0.1.1 $h" /etc/hosts || echo "127.0.1.1 $h" >> /etc/hosts
    chown root:root /etc/sudo.conf /etc/sudoers /etc/sudoers.d /usr/bin/sudo
    chown -R root:root /etc/sudoers.d
    chmod 0644 /etc/sudo.conf
    chmod 0440 /etc/sudoers
    chmod 0755 /etc/sudoers.d
    find /etc/sudoers.d -type f -exec chmod 0440 {} +
    chmod 4755 /usr/bin/sudo
    if [ -L /home/guest ]; then rm -f /home/guest; fi
    mkdir -p /home/guest
    chown -R guest:guest /home/guest
    chmod 0755 /home/guest
    if [ ! -f /run/serial-autologin.started ]; then
        touch /run/serial-autologin.started
        (while true; do /sbin/agetty -L --autologin guest -8 115200 ttyS0 vt220; sleep 1; done) &
    fi
fi

exit 0
EOF

RUN chmod +x /etc/rc.local && \
    if [ -f /etc/inittab ] && ! grep -q '/etc/rc.local' /etc/inittab; then \
    printf 'rc::sysinit:/etc/rc.local\n' >> /etc/inittab; \
    fi

# firecracker guest kernel does not expose these filesystems; mask their mount units to avoid boot failures
RUN mkdir -p /etc/systemd/system && \
    ln -sf /dev/null /etc/systemd/system/dev-hugepages.mount && \
    ln -sf /dev/null /etc/systemd/system/dev-mqueue.mount && \
    ln -sf /dev/null /etc/systemd/system/sys-kernel-debug.mount && \
    ln -sf /dev/null /etc/systemd/system/sys-kernel-tracing.mount && \
    ln -sf /dev/null /etc/systemd/system/sys-fs-fuse-connections.mount && \
    ln -sf /dev/null /etc/systemd/system/sys-kernel-config.mount && \
    ln -sf /dev/null /etc/systemd/system/apt-daily.timer && \
    ln -sf /dev/null /etc/systemd/system/apt-daily-upgrade.timer && \
    ln -sf /dev/null /etc/systemd/system/dpkg-db-backup.timer && \
    ln -sf /dev/null /etc/systemd/system/e2scrub_all.timer && \
    ln -sf /dev/null /etc/systemd/system/motd-news.timer && \
    ln -sf /dev/null /etc/systemd/system/systemd-tmpfiles-clean.timer && \
    ln -sf /dev/null /etc/systemd/system/proc-sys-fs-binfmt_misc.automount && \
    ln -sf /dev/null /etc/systemd/system/proc-sys-fs-binfmt_misc.mount && \
    ln -sf /dev/null /etc/systemd/system/systemd-binfmt.service && \
    ln -sf /dev/null /etc/systemd/system/getty@tty1.service && \
    ln -sf /dev/null /etc/systemd/system/getty@tty2.service && \
    ln -sf /dev/null /etc/systemd/system/getty@tty3.service && \
    ln -sf /dev/null /etc/systemd/system/getty@tty4.service && \
    ln -sf /dev/null /etc/systemd/system/getty@tty5.service && \
    ln -sf /dev/null /etc/systemd/system/getty@tty6.service && \
    ln -sf /dev/null /etc/systemd/system/getty-static.service && \
    ln -sf /dev/null /etc/systemd/system/console-getty.service && \
    ln -sf /dev/null /etc/systemd/system/rc-local.service && \
    ln -sf /dev/null /etc/systemd/system/modprobe@drm.service && \
    ln -sf /dev/null /etc/systemd/system/modprobe@efi_pstore.service && \
    ln -sf /dev/null /etc/systemd/system/modprobe@loop.service