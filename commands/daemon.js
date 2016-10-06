'use strict';

module.exports = exports;

/**
 * @param whaler
 */
function exports(whaler) {

    whaler.get('cli')
        .command('rsync:daemon <ref> [volume]')
        //.alias('rsync-daemon')
        .description('Rsync daemon', {
            ref: 'Application or container name',
            volume: 'Volume'
        })
        .action(function* (ref, volume, options) {
            let data;
            try {
                data = yield whaler.$emit('rsync:daemon', {
                    ref: ref,
                    volume: volume
                });
            } catch (e) {
                data = {
                    type: 'error',
                    msg: e.message
                };
            }

            console.log(JSON.stringify(data));
        })._noHelp = true;

}
