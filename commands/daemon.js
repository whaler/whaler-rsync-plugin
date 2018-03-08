'use strict';

module.exports = cmd;

/**
 * @param whaler
 */
async function cmd (whaler) {

    (await whaler.fetch('cli')).default

        .command('rsync:daemon <ref> [volume]')
        //.alias('rsync-daemon')
        .description('Rsync daemon', {
            ref: 'Application or container name',
            volume: 'Volume'
        })
        .action(async (ref, volume, options, util) => {
            ref = util.prepare('ref', ref);

            let data;
            try {
                data = await whaler.emit('rsync:daemon', { ref, volume });
            } catch (e) {
                data = {
                    type: 'error',
                    msg: e.message
                };
            }

            console.log(JSON.stringify(data));
        })._noHelp = true;

}
