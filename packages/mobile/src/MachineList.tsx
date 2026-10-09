import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";
import { hello, normalizeUrl } from "./machines";
import { t, type Key } from "./strings";
import { useColors, useStyles, type Palette } from "./theme";

interface Props {
  machines: Machine[];
  notifications: "on" | "off" | "denied";
  batteryRestricted: boolean;
  onAdd: (machine: Machine) => void;
  onRemove: (id: string) => void;
  onOpen: (machine: Machine) => void;
  onToggleNotifications: () => void;
  onFixBattery: () => void;
}

function errorKey(error: unknown): Key {
  const message = error instanceof Error ? error.message : "";
  if (message === "forbidden") return "errorForbidden";
  if (message === "not-kivotos") return "errorNotKivotos";
  return "errorUnreachable";
}

const keyOf = (machine: Machine): string => machine.id;

interface RowProps {
  machine: Machine;
  onOpen: (machine: Machine) => void;
  onRemove: (machine: Machine) => void;
}

function MachineRow({ machine, onOpen, onRemove }: RowProps) {
  const styles = useStyles(createStyles);
  const open = useCallback(() => onOpen(machine), [machine, onOpen]);
  const remove = useCallback(() => onRemove(machine), [machine, onRemove]);
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.rowPressed : styles.row),
    [styles],
  );
  return (
    <Pressable onPress={open} onLongPress={remove} style={rowStyle}>
      <Text style={styles.rowName} numberOfLines={1}>
        {machine.name}
      </Text>
      <Text style={styles.rowUrl} numberOfLines={1}>
        {machine.url}
      </Text>
    </Pressable>
  );
}

function EmptyList() {
  const styles = useStyles(createStyles);
  return <Text style={styles.empty}>{t("empty")}</Text>;
}

/** The app's home: machines to open, plus the notification switch. */
export function MachineList(props: Props) {
  const styles = useStyles(createStyles);
  const colors = useColors();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);
  const mounted = useRef(true);
  const { machines, onAdd, onRemove, onOpen } = props;
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const add = useCallback(async () => {
    const url = normalizeUrl(input);
    if (url === null) {
      setError("errorInvalid");
      return;
    }
    if (machines.some((machine) => machine.url === url)) {
      setError("duplicate");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const who = await hello(url);
      onAdd({ id: url, name: who.name, url });
      if (mounted.current) setInput("");
    } catch (failure) {
      if (mounted.current) setError(errorKey(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [input, machines, onAdd]);
  const submit = useCallback(() => void add(), [add]);

  const confirmRemove = useCallback(
    (machine: Machine) => {
      Alert.alert(t("removeConfirm", { name: machine.name }), machine.url, [
        { text: t("cancel"), style: "cancel" },
        { text: t("remove"), style: "destructive", onPress: () => onRemove(machine.id) },
      ]);
    },
    [onRemove],
  );

  const renderItem = useCallback<ListRenderItem<Machine>>(
    ({ item }) => <MachineRow machine={item} onOpen={onOpen} onRemove={confirmRemove} />,
    [confirmRemove, onOpen],
  );

  let notificationLabel = t("notificationsOff");
  if (props.notifications === "on") notificationLabel = t("notificationsOn");
  else if (props.notifications === "denied") notificationLabel = t("notificationsDenied");
  const canAdd = !busy && input.trim() !== "";

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t("title")}</Text>
      <FlatList
        data={machines}
        keyExtractor={keyOf}
        ListEmptyComponent={EmptyList}
        renderItem={renderItem}
      />
      <View style={styles.addRow}>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={submit}
          placeholder={t("addPlaceholder")}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!busy}
          style={styles.input}
        />
        <Pressable
          onPress={submit}
          disabled={!canAdd}
          style={canAdd ? styles.button : styles.buttonDisabled}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>{t("add")}</Text>
          )}
        </Pressable>
      </View>
      {error === null ? null : <Text style={styles.error}>{t(error)}</Text>}
      <Pressable onPress={props.onToggleNotifications} style={styles.setting}>
        <Text style={styles.rowName}>{t("notifications")}</Text>
        <Text style={styles.rowUrl}>{notificationLabel}</Text>
      </Pressable>
      {props.notifications === "on" && props.batteryRestricted ? (
        <View style={styles.setting}>
          <Text style={styles.rowUrl}>{t("batteryHint")}</Text>
          <Pressable onPress={props.onFixBattery} style={styles.smallButton}>
            <Text style={styles.buttonText}>{t("batteryFix")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(c: Palette) {
  const row = {
    borderWidth: 0.5,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderColor: c.border,
  };
  const button = {
    borderRadius: 10,
    paddingHorizontal: 18,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.accent,
  } as const;
  return {
    root: { flex: 1, paddingHorizontal: 16, backgroundColor: c.bg },
    title: { fontSize: 28, fontWeight: "600", marginTop: 12, marginBottom: 12, color: c.text },
    empty: { fontSize: 15, lineHeight: 22, marginVertical: 24, color: c.muted },
    row: { ...row, backgroundColor: c.card },
    rowPressed: { ...row, backgroundColor: c.pressed },
    rowName: { fontSize: 16, fontWeight: "500", color: c.text },
    rowUrl: { fontSize: 13, marginTop: 2, color: c.muted },
    addRow: { flexDirection: "row", gap: 8, marginTop: 8 },
    input: {
      flex: 1,
      borderWidth: 0.5,
      borderRadius: 10,
      paddingHorizontal: 12,
      fontSize: 16,
      height: 46,
      color: c.text,
      backgroundColor: c.card,
      borderColor: c.border,
    },
    button,
    buttonDisabled: { ...button, opacity: 0.5 },
    smallButton: {
      alignSelf: "flex-start",
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      marginTop: 10,
      backgroundColor: c.accent,
    },
    buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
    error: { fontSize: 14, marginTop: 8, color: c.danger },
    setting: {
      borderWidth: 0.5,
      borderRadius: 12,
      padding: 14,
      marginTop: 16,
      borderColor: c.border,
      backgroundColor: c.card,
    },
  } as const;
}
