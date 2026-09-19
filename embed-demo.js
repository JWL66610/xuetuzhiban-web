const WEB_SDK_APP_KEY = "d9leeqd4shhc72oldb20";
const WEB_SDK_BASE_URL = "https://ai.yznu.edu.cn";

if (window.HiagentWebSDK?.WebLiteClient) {
  window.xuetuzhibanWebSdk = new window.HiagentWebSDK.WebLiteClient({
    appKey: WEB_SDK_APP_KEY,
    baseUrl: WEB_SDK_BASE_URL,
    variables: {},
    onLoad({ chatInstance }) {
      window.xuetuzhibanChat = chatInstance;
    }
  });
}
