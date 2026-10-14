// Zoho のウィジェット SDK は ZIP に同梱するのが確実（スキル zoho-crm-build 第11章）。
// 同梱できていない（app/ZohoEmbededAppSDK.min.js が無い）ときだけ、正しい URL から読み込む。
if (typeof ZOHO === "undefined") {
  document.write('<script src="https://live.zwidgets.com/js-sdk/1.2/ZohoEmbededAppSDK.min.js"><\/script>');
}
