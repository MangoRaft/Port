class Resource {
    constructor(size, port) {
        this.size = size;
        this.port = port;
        this.cores = new Map();
    }

    add(HostConfig) {
        if (this.size.memory) {
            HostConfig.Memory = this.size.memory * Math.pow(1024, 2)

            if (this.size.swap) {
                HostConfig.MemorySwap = HostConfig.Memory + (this.size.swap * Math.pow(1024, 2))
            }

            if (this.size.memoryReservation) {
                HostConfig.MemoryReservation = this.size.memoryReservation * Math.pow(1024, 2)
            }

        }
        if (this.size.cpu) {
            let coreCount = this.size.cpu;

            let cores = [];


            for (let index = 0; index < this.port.coresUsed.length; index++) {
                if (this.port.coresUsed[index] >= 1000) {
                    continue;
                }
                if (this.port.coresUsed[index] + coreCount > 1000) {
                    coreCount = (this.port.coresUsed[index] + coreCount) - 1000;
                    this.cores.set(index, 1000);
                    this.coresUsed[index] = 1000;
                    cores.push(index)
                } else {
                    let value = this.port.coresUsed[index] + coreCount;
                    this.port.coresUsed[index] = value;
                    this.cores.set(index, value);
                    cores.push(index);
                    break;

                }
            }
            HostConfig.CpusetCpus = cores.join(',');
            HostConfig.CpuPeriod = 100000;
            HostConfig.CpuQuota = this.size.cpu * 100;


        }

        if (this.size.io) {
            if (this.size.bandwidth) {
                HostConfig.IOMaximumBandwidth = this.size.io.bandwidth * Math.pow(512, 2)
            }
            if (this.size.iops) {
                HostConfig.IOMaximumIOps = this.size.io.iops * 100
            }
        }

        HostConfig.OomKillDisable = !!this.size.oomKillDisable
    }

    remove() {
        for (let index = 0; index < this.port.coresUsed.length; index++) {
            if (Number.isInteger(this.cores.get(index))) {
                this.port.coresUsed[index] = this.port.coresUsed[index] - this.cores.get(index)
            }

        }
    }

}

module.exports = Resource;