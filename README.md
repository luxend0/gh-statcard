# gh-statcard

A GitHub stats card for your profile README, rendered as one static SVG.
No server, no dependencies, Node 20 or newer.

```sh
GH_TOKEN=<token> node statcard.mjs --user <login> --out stats.svg
```

A token without any scopes is enough. Only public data is read.

## License

MIT
