'use strict';

module.exports = cmd;

/**
 * @param whaler
 */
async function cmd (whaler) {

    (await whaler.fetch('cli')).default

        .command('rsync:kill <container>')
        //.alias('rsync-kill')
        .description('Kill rsync daemon', {
            container: 'Rsync container name'
        })
        .action(async (container, options) => {
            await whaler.emit('rsync:kill', { container });
        })._noHelp = true;

}
