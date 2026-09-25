(function () {
  if (typeof document === "undefined" || typeof location === "undefined" || typeof navigator === "undefined") return;

  function bareHost(host) {
    return String(host || "").toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  }

  function sameSite(refHost, pageHost) {
    var a = bareHost(refHost);
    var b = bareHost(pageHost);
    if (!a || !b) return true;
    if (a === b) return true;
    var aSite = a === "aihateit.com" || a.endsWith(".aihateit.com");
    var bSite = b === "aihateit.com" || b.endsWith(".aihateit.com");
    return aSite && bSite;
  }

  var params = new URLSearchParams(location.search);
  var source = params.get("utm_source") || "";
  var medium = params.get("utm_medium") || "";
  var campaign = params.get("utm_campaign") || "";
  var content = params.get("utm_content") || "";
  var ref = params.get("ref") || "";
  if (!source && ref) {
    source = ref;
    if (!medium && ref.toLowerCase() === "x") medium = "social";
  }
  if (!source) {
    source = "direct";
    var refHost = "";
    try {
      if (document.referrer) refHost = new URL(document.referrer).hostname;
    } catch (err) {
      refHost = "";
    }
    if (refHost && !sameSite(refHost, location.hostname)) source = bareHost(refHost) || refHost;
  }

  var body = JSON.stringify({
    path: location.pathname,
    source: source,
    medium: medium,
    campaign: campaign,
    content: content
  });
  var url = "/api/hit";
  var queued = false;
  if (typeof navigator.sendBeacon === "function") {
    try {
      queued = navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
    } catch (err) {
      queued = false;
    }
  }
  if (!queued && typeof fetch === "function") {
    fetch(url, {
      method: "POST",
      body: body,
      headers: { "Content-Type": "text/plain" },
      keepalive: true,
      credentials: "omit"
    });
  }
})();
