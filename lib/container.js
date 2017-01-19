'use strict';

var image = 'cravler/rsync';

module.exports = rsyncContainer;
module.exports.pullImage = pullImage;

function* rsyncContainer(options) {
    const docker = this;

    const createOpts = {
        'name': 'whaler_' + (options['ref'] ? options['ref'] + '_' : '') + process.pid,
        'Image': image,
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

    return yield docker.createContainer.$call(docker, createOpts);
}

function* pullImage(followPull) {
    const docker = this;

    try {
        if (followPull || false) {
            yield docker.followPull.$call(docker, image);
        } else {
            const stream = yield docker.pull.$call(docker, image);
            yield docker.modem.followProgress.$call(docker.modem, stream);
        }
    } catch (e) {}
}
