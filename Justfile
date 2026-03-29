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
        --mount type=bind,src=$(pwd)/images,dst=/images \
        firecracker-docker bash
