'use strict';

var fs = require('fs');
var util = require('util');
var path = require('path');
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
        let fileName = null;

        if (serviceName) {
            let volume = options['volume'];
            if (!volume) {
                throw new Error('In case of container name is provided, volume is mandatory!');
            }

            const container = docker.getContainer(serviceName + '.' + appName);
            const info = yield container.inspect.$call(container);
            let destination = null;
            for (let mount of info['Mounts']) {
                const index = volume.indexOf(mount['Destination']);
                if (0 === index) {
                    destination = mount['Destination'];
                    volume = volume.substr(destination.length);
                    src = mount['Source'] + volume;

                    try {
                        const stat = yield fs.lstat.$call(null, src);
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

        } else if (options['volume']) {
            src = path.join(src, options['volume']);

            try {
                const stat = yield fs.lstat.$call(null, src);
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
            exclude: yield rsyncExclude.$call(null, src + '/.rsyncignore'),
            file: fileName
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
            return util.format('--exclude=%s', rule);
        });
    } catch (e) {}

    return exclude;
}
