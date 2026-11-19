# omp-tools moved to tern-plugins

The Oh My Pi plugin now lives in [`omp/` in daandden/tern-plugins](https://github.com/daandden/tern-plugins/tree/master/omp).

To relink the plugin, clone `tern-plugins` and run `omp plugin link` with the path to its `omp/` directory:

```sh
git clone https://github.com/daandden/tern-plugins.git
omp plugin link ./tern-plugins/omp
```

The commit history, pull requests, closed issues, and old [changelog](CHANGELOG.md) remain in this repository.
