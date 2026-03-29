FROM ubuntu:24.04

RUN apt-get update && apt-get -y install sudo && \
    rm -rf /var/lib/apt/lists/*

# create user and auto login to serial console
RUN useradd -m -s /bin/bash guest && echo "guest:password" | chpasswd && \
    mkdir -p /etc/systemd/system/serial-getty@ttyS0.service.d/ && \
    printf '[Unit]\nAfter=\nBindsTo=\n\n[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin guest --noclear %%I $TERM\n' \
    > /etc/systemd/system/serial-getty@ttyS0.service.d/override.conf && \
    passwd -d guest

# add guest to sudoers
RUN echo "guest ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers && \
    usermod -aG sudo guest

# allow guest to run /sbin/reboot without password
RUN echo "guest ALL=(ALL) NOPASSWD:/sbin/reboot" >> /etc/sudoers && \
    echo "sudo /sbin/reboot -f" >> /home/guest/.bash_logout && \
    echo "#!/bin/bash\nsudo /sbin/reboot -f" > /usr/bin/stop-guest && chmod +x /usr/bin/stop-guest