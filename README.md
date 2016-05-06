# Whaler rsync plugin

## Install

```sh
$ whaler plugins:install whaler-rsync-plugin
```

## Usage

Sync files from current dir to remote machine

```sh
$ whaler rsync . <app>@<domain name or IP>
```

Sync files from remote machine to current dir

```sh
$ whaler rsync <app>@<domain name or IP> .
```

## License

This software is under the MIT license. See the complete license in:

```
LICENSE
```
