#!/bin/bash

ip tuntap add tap0 mode tap
ip addr add 172.16.0.1/24 dev tap0
ip link set tap0 up

# Find the container's default interface (usually eth0)
DEFAULT_IF=$(ip route | awk '/default/{print $5}')

iptables -t nat -A POSTROUTING -o $DEFAULT_IF -j MASQUERADE
iptables -A FORWARD -i tap0 -o $DEFAULT_IF -j ACCEPT
iptables -A FORWARD -i $DEFAULT_IF -o tap0 -m state --state RELATED,ESTABLISHED -j ACCEPT
sysctl -w net.ipv4.ip_forward=1

./firecracker-v1.15.0-x86_64 --no-api --config-file /images/base/artifacts/vmconfig.json