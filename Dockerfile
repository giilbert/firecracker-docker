FROM ubuntu:24.04

ARG version="1.15.0"
WORKDIR /firecracker

RUN apt-get update && apt-get install -y wget

RUN wget https://github.com/firecracker-microvm/firecracker/releases/download/v${version}/firecracker-v${version}-x86_64.tgz && \
    tar -xzf firecracker-v${version}-x86_64.tgz --strip-components=1


ADD entrypoint.sh ./entrypoint.sh