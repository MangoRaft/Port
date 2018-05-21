class Resource {
    constructor(size, port) {
        this.size = size;
        this.port = port;
        this.quota = 100000;
        this.period = 100000;
        this.cpuset = '0,1,2,3,4,5';
        this.cores = {};
    }

    add(HostConfig) {
        if (this.size.memory) {
            HostConfig.Memory = this.size.memory * Math.pow(1024, 2)
            this.port.usagedMemory += HostConfig.Memory;
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
                    this.cores[index] = 1000;
                    this.port.coresUsed[index] = 1000;
                    cores.push(index)
                } else {
                    this.port.coresUsed[index] = this.port.coresUsed[index] + coreCount;
                    this.cores[index] = coreCount;
                    cores.push(index);
                    break;

                }
            }
            this.cpuset = cores.join(',');
            //HostConfig.CpuPeriod = this.period;
            this.quota = this.size.cpu * 100;
        }

        if (this.size.io) {
            if (this.size.bandwidth) {
                HostConfig.IOMaximumBandwidth = this.size.io.bandwidth * Math.pow(512, 2)
            }
            if (this.size.iops) {
                HostConfig.IOMaximumIOps = this.size.io.iops * 100
            }
        }

        if (this.size.pids) {
            HostConfig.PidsLimit = this.size.pids
        } else {
            HostConfig.PidsLimit = -1
        }

        HostConfig.OomKillDisable = !!this.size.oomKillDisable
    }

    update() {
        return {
            CpusetCpus: this.cpuset,
            CpuPeriod: this.period,
            CpuQuota: this.quota
        }
    }

    remove() {
        for (let i = 0; i < this.port.cores; i++) {
            if (Number.isInteger(this.cores[i])) {
                this.port.coresUsed[i] = this.port.coresUsed[i] - this.cores[i]
            }
        }
        if (this.size.memory) {
            this.port.usagedMemory = this.port.usagedMemory - (this.size.memory * Math.pow(1024, 2));
            if (this.port.usagedMemory < 0) {
                this.port.usagedMemory = 0;
            }
        }
    }

}

module.exports = Resource;