'use strict';

var fs = require('fs');
var util = require('util');
var crypto = require('crypto');

module.exports = function(whaler) {

    whaler.on('rsync:daemon', function* (options) {
        let appName = options['ref'];
        let serviceName = null;

        const parts = options['ref'].split('.');
        if (2 == parts.length) {
            appName = parts[1];
            serviceName = parts[0];
        }

        const docker = whaler.get('docker');
        const storage = whaler.get('apps');
        const app = yield storage.get.$call(storage, appName);
        let src = app.path;

        if (serviceName) {
            const volume = options['volume'];
            if (!volume) {
                throw new Error('In case of container name is provided, volume is mandatory!');
            }

            const container = docker.getContainer(serviceName + '.' + appName);
            const info = yield container.inspect.$call(container);
            let volumes = null;
            if (info['Config']['Volumes']) {
                volumes = Object.keys(info['Config']['Volumes']);
            }

            if (null === volumes || -1 === volumes.indexOf(volume)) {
                throw new Error('Volume "' + volume + '" no found!');
            }

            const mounts = info['Mounts'];
            for (let mount of mounts) {
                if (volume == mount['Destination']) {
                    src = mount['Source'];
                }
            }
        }

        const credentials = {
            username: randomHexValue(12),
            password: randomHexValue(12)
        };

        const rsyncContainer = require('../lib/container');

        const container = yield rsyncContainer.$call(null, docker, {
            src: src,
            ref: 'rsync-daemon-' + options['ref'],
            env: [
                'USERNAME=' + credentials['username'],
                'PASSWORD=' + credentials['password']
            ]
        });

        try {
            yield container.start.$call(container, {});
        } catch (e) {
            yield container.remove.$call(container, {
                force: true,
                v: true
            });
            throw e;
        }

        const info = yield container.inspect.$call(container);

        let port = null;
        if (info['NetworkSettings']['Ports']['873/tcp']) {
            port = info['NetworkSettings']['Ports']['873/tcp'][0]['HostPort'];
        }

        return {
            port: port,
            username: credentials['username'],
            password: credentials['password'],
            container: info['Name'].substring(1),
            exclude: yield rsyncExclude.$call(null, src + '/.rsyncignore')
        };
    });
};

// PRIVATE

/**
 * @param len
 * @returns {string}
 */
function randomHexValue(len) {
    return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

/**
 * @param file
 * @returns {*}
 */
function* rsyncExclude(file) {
    let exclude = [];
    try {
        const content = yield fs.readFile.$call(null, file, 'utf8');
        exclude = content.split('\n').filter((rule) => {
            return rule.length > 0;
        }).map((rule) => {
            return util.format('--exclude="%s"', rule);
        });
    } catch (e) {}

    return exclude;
}
