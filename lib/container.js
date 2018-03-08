'use strict';

const util = require('util');

const IMAGE = 'cravler/rsync';

module.exports = rsyncContainer;
module.exports.pullImage = pullImage;

async function rsyncContainer (docker, options) {
    const createOpts = {
        'name': 'whaler_' + (options['ref'] ? options['ref'] + '_' : '') + process.pid,
        'Image': IMAGE,
        'Tty': true,
        'Env': options['env'] || [],
        'Volumes': {
            '/volume': {}
        },
        'ExposedPorts': {
            '873/tcp': {}
        },
        'HostConfig': {
            'PortBindings': {
                '873/tcp': [
                    {
                        'HostIp': '',
                        'HostPort': ''
                    }
                ]
            }
        }
    };

    if (options['src']) {
        createOpts['HostConfig']['Binds'] = [
            options['src'] + ':/volume'
        ];
    }

    if (options['cmd']) {
        createOpts['Cmd'] = options['cmd'];
    }

    return await docker.createContainer(createOpts);
}

async function pullImage (docker, followPull) {
    try {
        if (followPull || false) {
            await docker.followPull(IMAGE);
        } else {
            const stream = await docker.pull(IMAGE);
            await util.promisify(docker.modem.followProgress)(stream);
        }
    } catch (e) {}
}
