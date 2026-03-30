#!/bin/sh
PREREQ=""
prereqs() { echo "$PREREQ"; }
case "$1" in prereqs) prereqs; exit 0;; esac
. /scripts/functions

log_begin_msg "Setting up overlay filesystem"

LOG_DEV=/dev/null
if [ -c /dev/kmsg ] && [ -w /dev/kmsg ]; then
    LOG_DEV=/dev/kmsg
fi

log_msg() {
    echo "$1" > "$LOG_DEV" 2>/dev/null || true
}

log_msg "overlay: rootmnt=${rootmnt}"
log_msg "overlay: devices:"
ls /dev/vd* > "$LOG_DEV" 2>&1 || log_msg "overlay: no vd devices found"

mkdir -p /mnt/data
blkid /dev/vdb > "$LOG_DEV" 2>&1 || mkfs.ext4 /dev/vdb
mount /dev/vdb /mnt/data && log_msg "overlay: mounted vdb" || log_msg "overlay: failed to mount vdb"
mkdir -p /mnt/data/upper /mnt/data/work /mnt/newroot

log_msg "overlay: installing overlay kernel module"
insmod /lib/modules/$(uname -r)/kernel/fs/overlayfs/overlay.ko 2>"$LOG_DEV" && \
    log_msg "overlay: insmod ok" || \
    log_msg "overlay: insmod failed"

mount -t overlay overlay -o lowerdir=${rootmnt},upperdir=/mnt/data/upper,workdir=/mnt/data/work /mnt/newroot 2>"$LOG_DEV"
mount --move /mnt/newroot ${rootmnt} && log_msg "overlay: pivot done" || log_msg "overlay: pivot failed"

log_end_msg