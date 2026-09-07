/**
 * Bootstrap shim, following Zotero's official make-it-red example and the
 * Zotero 7 plugin documentation. Plain JS by necessity — it runs before the
 * bundle is loaded. No JSM imports, no Bluebird, no Zotero.spawn().
 */

var chromeHandle;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  await Zotero.initializationPromise;

  const aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "chrome/content/"],
  ]);

  // Sandbox for the bundle: everything assigned to `_globalThis` is global to
  // the plugin's own code and invisible to the rest of Zotero.
  const ctx = {
    rootURI,
    document: Zotero.getMainWindow().document,
  };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/chrome/content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup(rootURI);
}

function onMainWindowLoad({ window: win }) {
  Zotero.__addonInstance__?.hooks?.onMainWindowLoad?.(win);
}

function onMainWindowUnload({ window: win }) {
  Zotero.__addonInstance__?.hooks?.onMainWindowUnload?.(win);
}

function shutdown({ id, version, resourceURI, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) {
    return;
  }
  // Run the plugin's own teardown, but never let a failure in it abort the
  // chrome deregistration below.
  try {
    Zotero.__addonInstance__?.hooks?.onShutdown?.();
  } catch (e) {
    Zotero.debug("[annotation-compositor] onShutdown failed: " + e);
  }
  if (chromeHandle) {
    try {
      chromeHandle.destruct();
    } catch (e) {
      Zotero.debug("[annotation-compositor] chromeHandle.destruct failed: " + e);
    }
    chromeHandle = null;
  }
}

function uninstall(data, reason) {}
