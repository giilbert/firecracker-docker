build-docker:
    docker build -t firecracker-docker .

clean:
    rm -f images/ubuntu/ubuntu.raw
    rm -f images/ubuntu/initrd.img
    rm -f images/ubuntu/vmlinux

build-images:
    cd images/ubuntu && ./build.sh

build: build-docker build-images

bash:
    docker run \
        --privileged \
        -it --rm --device /dev/kvm \
        --cap-add NET_ADMIN \
        --cap-add NET_RAW \
        --device /dev/net/tun \
        --sysctl net.ipv4.ip_forward=1 \
        --mount type=bind,src=$(pwd)/images,dst=/images \
        --name firecracker-docker \
        firecracker-docker bash
