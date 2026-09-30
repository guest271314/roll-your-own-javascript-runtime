## nm_runjs

JavaScript and TypeScript Native Messaging host implemented using `deno_core`.

### Build
```shell
cargo build --release
```
### Test
```shell
./nm_standalone_test.js ./target/release/nm_runjs
```

### Installation and usage on Chrome and Chromium

1. Navigate to `chrome://extensions`.
2. Toggle `Developer mode`.
3. Click `Load unpacked`.
4. Select `roll-your-own-javascript-runtime` folder.
5. Note the generated extension ID.
6. Open `nm_runjs.json` in a text editor, set `"path"` to absolute path of `nm_runjs` and `chrome-extension://<ID>/` using ID from 5 in `"allowed_origins"` array.
7. Copy the `nm_runjs.json` file to Chrome or Chromium configuration folder, e.g., Chromium on Linux `~/.config/chromium/NativeMessagingHosts`; Chrome dev channel on Linux `~/.config/google-chrome-unstable/NativeMessagingHosts`.
8. To test click `service worker` link in panel of unpacked extension which is DevTools for `background.js` in MV3 `ServiceWorker`, observe echo'ed message from `nm_runjs` Native Messaging host. To disconnect run `port.disconnect()`.

The Native Messaging host echoes back the message passed. 

For differences between OS and browser implementations see [Chrome incompatibilities](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities#native_messaging).

## License
Do What the Fuck You Want to Public License [WTFPLv2](http://www.wtfpl.net/about/)
