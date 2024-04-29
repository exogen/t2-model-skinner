# t2-model-skinner

[Launch the app!](https://exogen.github.io/t2-model-skinner/)

## Support

Did this project bring you joy? Want to request a feature? Check out
[my GitHub Sponsors page](https://github.com/sponsors/exogen).

Alternatively…

<a href="https://www.buymeacoffee.com/mosswood" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;"></a>

## Development

Clone the repository and run:

```sh
npm install
```

Then run `npm start` to launch the development server:

```sh
npm start
```

Build the production version of the app with `npm run build`:

```sh
npm run build
```

You will also need to clone the [t2-skins](https://github.com/exogen/t2-skins)
repository, which is the source for all the custom skins that will be listed in
the dropdown menu. Adding a new skin to that repository will make it
automatically appear in the menu during build time.

If [t2-skins](https://github.com/exogen/t2-skins) is not a sibling folder to
`t2-model-skinner`, set the `T2_SKINS_PATH` environment variable to its path.
