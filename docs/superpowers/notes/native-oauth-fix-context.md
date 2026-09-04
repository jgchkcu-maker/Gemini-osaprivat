# Native OAuth production fix context

The production dashboard currently reports OAuth credentials missing when neither custom Google Web OAuth credentials nor Antigravity env overrides are configured.

Expected behavior: provider-native Antigravity OAuth remains available out of the box using the public OAuth client distributed by the upstream/native client pattern, while explicit env values remain higher-priority overrides. Custom Google Web OAuth stays optional and separate.

This note documents the regression being fixed; implementation is covered by tests/oauth-defaults.test.js.
