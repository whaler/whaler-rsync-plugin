'use strict';

module.exports = exports;

/**
 * @param whaler
 */
async function exports (whaler) {

    whaler.on('rsync:kill', async ctx => {
        if (0 !== ctx.options['container'].indexOf('whaler_rsync-daemon-')) {
            throw new Error('Error');
        }

        const { default: docker } = await whaler.fetch('docker');
        const container = docker.getContainer(ctx.options['container']);
        await container.remove({
            v: true,
            force: true
        });
    });

}