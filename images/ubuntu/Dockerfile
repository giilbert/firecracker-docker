FROM ubuntu:24.04

RUN apt-get update && apt-get -y install sudo iproute2 iptables

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

RUN chmod u+s /usr/bin/ping

# configure network for guest
RUN mkdir -p /etc/systemd/network && \
    printf '[Match]\nName=eth0\n\n[Network]\nAddress=172.16.0.2/24\nGateway=172.16.0.1\nDNS=8.8.8.8\n' \
    > /etc/systemd/network/10-eth0.network