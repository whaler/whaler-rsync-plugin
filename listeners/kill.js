'use strict';

module.exports = exports;

/**
 * @param whaler
 */
function exports(whaler) {

    whaler.on('rsync:kill', function* (options) {
        if (0 !== options['container'].indexOf('whaler_rsync-daemon-')) {
            throw new Error('Error');
        }

        const docker = whaler.get('docker');
        const container = docker.getContainer(options['container']);
        yield container.remove.$call(container, {
            v: true,
            force: true
        });
    });

}