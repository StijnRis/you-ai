import { Pressable, Text, View } from "react-native";
import { Link, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { countAwaitingEvaluation } from "@youai/core/experiments/store";
import { getSetting } from "@youai/core/settings";
import { Card, SectionHeading } from "@youai/ui";
import { Screen } from "../../components/screen";
import { useQuery } from "../../lib/use-query";

type IconName = keyof typeof Ionicons.glyphMap;

const LINKS: { href: Href; label: string; description: string; icon: IconName; badgeKey?: "experiments" }[] = [
  { href: "/experiments", label: "Experiments", description: "Change one thing, measure what moved.", icon: "flask-outline", badgeKey: "experiments" },
  { href: "/data", label: "Data", description: "Every metric and where it came from.", icon: "server-outline" },
  { href: "/import", label: "Import", description: "Bring in an export file from any service.", icon: "cloud-upload-outline" },
  { href: "/sources", label: "Sources", description: "Weather, GitHub, calendars, Spotify.", icon: "git-network-outline" },
  { href: "/conversions", label: "Conversions", description: "How each file format becomes events.", icon: "color-wand-outline" },
  { href: "/settings", label: "Settings", description: "API keys, timezone, location, server.", icon: "settings-outline" },
];

export default function MoreScreen() {
  const { data: awaiting } = useQuery(async () => countAwaitingEvaluation(await getSetting("timezone")));
  return (
    <Screen tab>
      <SectionHeading title="More" />
      <View className="gap-2">
        {LINKS.map((link) => (
          <Link key={link.label} href={link.href} asChild>
            <Pressable>
              <Card className="flex-row items-center gap-3">
                <Ionicons name={link.icon} size={20} color="#78716c" />
                <View className="flex-1">
                  <Text className="font-medium text-text">{link.label}</Text>
                  <Text className="text-sm text-muted">{link.description}</Text>
                </View>
                {link.badgeKey && awaiting ? (
                  <View className="min-w-5 items-center rounded-full bg-accent px-1.5 py-0.5">
                    <Text className="text-[10px] font-semibold text-bg">{awaiting > 9 ? "9+" : awaiting}</Text>
                  </View>
                ) : null}
                <Ionicons name="chevron-forward" size={16} color="#a8a29e" />
              </Card>
            </Pressable>
          </Link>
        ))}
      </View>
    </Screen>
  );
}
