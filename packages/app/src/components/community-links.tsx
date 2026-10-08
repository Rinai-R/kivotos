import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { openExternalUrl } from "@/utils/open-external-url";

const REPOSITORY_URL = "https://github.com/Rinai-R/kivotos";

const renderGitHubIcon = (color: string) => <GitHubIcon color={color} size={14} />;

export function CommunityLinks() {
  const handleOpenRepository = useCallback(() => {
    void openExternalUrl(REPOSITORY_URL);
  }, []);

  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={renderGitHubIcon}
        onPress={handleOpenRepository}
        testID="community-links-github"
      >
        GitHub
      </Button>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
