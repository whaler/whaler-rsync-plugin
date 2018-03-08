'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const fsLstat = util.promisify(fs.lstat);
const fsReadFile = util.promisify(fs.readFile);
const rsyncContainer = require('../lib/container');

module.exports = async function exports (whaler) {

    whaler.on('rsync:daemon', async ctx => {
        let appName = ctx.options['ref'];
        let serviceName = null;

        const parts = ctx.options['ref'].split('.');
        if (2 == parts.length) {
            appName = parts[1];
            serviceName = parts[0];
        }

        const { default: docker } = await whaler.fetch('docker');
        const { default: storage } = await whaler.fetch('apps');
        const app = await storage.get(appName);
        let src = app.path;
        let fileName = null;

        if (serviceName) {
            let volume = ctx.options['volume'];
            if (!volume) {
                throw new Error('In case of container name is provided, volume is mandatory!');
            }

            const container = docker.getContainer(serviceName + '.' + appName);
            const info = await container.inspect();
            let destination = null;
            for (let mount of info['Mounts']) {
                const index = volume.indexOf(mount['Destination']);
                if (0 === index) {
                    destination = mount['Destination'];
                    volume = volume.substr(destination.length);
                    src = mount['Source'] + volume;

                    try {
                        const stat = await fsLstat(src);
                        if (!stat.isDirectory()) {
                            fileName = path.basename(src);
                            src = path.dirname(src);
                        }
                    } catch (e) {}
                }
            }

            if (null === destination) {
                throw new Error('Volume "' + volume + '" rejected!');
            }

        } else if (ctx.options['volume']) {
            src = path.join(src, ctx.options['volume']);

            try {
                const stat = await fsLstat(src);
                if (!stat.isDirectory()) {
                    fileName = path.basename(src);
                    src = path.dirname(src);
                }
            } catch (e) {}
        }

        const credentials = {
            username: randomHexValue(12),
            password: randomHexValue(12)
        };

        await rsyncContainer.pullImage(docker);

        const container = await rsyncContainer(docker, {
            src: src,
            ref: 'rsync-daemon-' + ctx.options['ref'],
            env: [
                'USERNAME=' + credentials['username'],
                'PASSWORD=' + credentials['password']
            ]
        });

        try {
            await container.start({});
        } catch (e) {
            await container.remove({
                force: true,
                v: true
            });
            throw e;
        }

        const info = await container.inspect();

        let port = null;
        if (info['NetworkSettings']['Ports']['873/tcp']) {
            port = info['NetworkSettings']['Ports']['873/tcp'][0]['HostPort'];
        }

        ctx.result = {
            port: port,
            username: credentials['username'],
            password: credentials['password'],
            container: info['Name'].substring(1),
            exclude: await rsyncExclude(src + '/.rsyncignore'),
            file: fileName
        };
    });
};

// PRIVATE

/**
 * @param len
 * @returns {string}
 */
function randomHexValue (len) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

/**
 * @param file
 * @returns {Array}
 */
async function rsyncExclude (file) {
    let exclude = [];
    try {
        const content = await fsReadFile(file, 'utf8');
        exclude = content.split('\n').filter(rule => {
            return rule.length > 0;
        }).map(rule => {
            return util.format('--exclude=%s', rule);
        });
    } catch (e) {}

    return exclude;
}
