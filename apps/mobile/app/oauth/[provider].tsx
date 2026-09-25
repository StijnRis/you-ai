import { Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

/*
 * Where OAuth providers send the browser back to (youai://oauth/github, or
 * /oauth/github on web). On web this page runs inside the popup and hands the
 * URL back to the window that opened it; on native the auth session usually
 * intercepts the redirect before this screen ever renders.
 */
WebBrowser.maybeCompleteAuthSession();

export default function OAuthReturn() {
  return (
    <View className="flex-1 items-center justify-center bg-bg p-6">
      <Text className="text-sm text-muted">Connected — you can close this window.</Text>
    </View>
  );
}
