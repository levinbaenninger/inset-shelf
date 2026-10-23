import type { SettingsView } from "@shared/settings";
import { useId } from "react";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { settingsBridge } from "@/shared/bridge";
import { isMac, isWindows } from "@/shared/platform";
import { usePushedView } from "@/shared/use-pushed-view";

const api = settingsBridge();

const load = async (): Promise<SettingsView> => await api.getView();

const subscribe = (listener: (view: SettingsView | null) => void) =>
  api.on("view", listener);

const ICON_LABELS = {
  dock: "Dock Only",
  dockAndMenuBar: "Dock and Menu Bar",
  menuBar: "Menu Bar Only",
} as const;

const isIconPlace = (value: string): value is keyof typeof ICON_LABELS =>
  Object.hasOwn(ICON_LABELS, value);

/** A settings row: the label on the left, its control on the right, an optional note below. */
const Row = ({
  children,
  label,
  labelFor,
  note,
}: {
  readonly label: string;
  readonly labelFor: string;
  readonly note?: string;
  readonly children: ReactNode;
}) => (
  <div className="flex flex-col gap-1 px-3 py-2.5">
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={labelFor}>{label}</Label>
      {children}
    </div>
    {note === undefined ? null : (
      <p className="text-muted-foreground text-xs">{note}</p>
    )}
  </div>
);

const Group = ({
  children,
  title,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <section className="flex flex-col gap-1.5">
    <h2 className="text-muted-foreground px-1 text-xs font-medium">{title}</h2>
    <div className="bg-foreground/5 divide-foreground/10 flex flex-col divide-y rounded-lg">
      {children}
    </div>
  </section>
);

const SettingsForm = ({ view }: { readonly view: SettingsView }) => {
  const loginId = useId();
  const iconId = useId();
  const copyId = useId();
  const { settings } = view;

  return (
    <main
      className={cn(
        "bg-background text-foreground flex min-h-svh flex-col gap-4 p-4",
        // On Windows the window has no title bar: this strip moves it, under its close button.
        isWindows && "pt-0"
      )}
    >
      {isWindows ? (
        <div aria-hidden="true" className="drag-region -mx-4 -mb-2 h-9" />
      ) : null}
      <h1 className="sr-only">Settings</h1>
      <Group title="General">
        <Row label="Open at Login" labelFor={loginId}>
          <Switch
            checked={view.openAtLogin}
            id={loginId}
            onCheckedChange={(checked) => {
              api.setOpenAtLogin(checked);
            }}
          />
        </Row>
        {/* Elsewhere the notification-area icon is the app's only icon, so there is no choice. */}
        {isMac ? (
          <Row
            label="Show app icon in"
            labelFor={iconId}
            note={
              settings.iconIn === "menuBar"
                ? "Without a Dock icon, the app has no menu bar of its own; use the menu-bar icon instead."
                : undefined
            }
          >
            <Select
              onValueChange={(value) => {
                if (isIconPlace(value)) {
                  api.update({ iconIn: value });
                }
              }}
              value={settings.iconIn}
            >
              <SelectTrigger id={iconId} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dockAndMenuBar">
                  {ICON_LABELS.dockAndMenuBar}
                </SelectItem>
                <SelectItem value="dock">{ICON_LABELS.dock}</SelectItem>
                <SelectItem value="menuBar">{ICON_LABELS.menuBar}</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        ) : null}
      </Group>
      <Group title="Copying">
        <Row
          label="Mark as done when copied"
          labelFor={copyId}
          note="Copying an item checks it off, so using it and clearing it is one step."
        >
          <Switch
            checked={settings.markDoneOnCopy}
            id={copyId}
            onCheckedChange={(checked) => {
              api.update({ markDoneOnCopy: checked });
            }}
          />
        </Row>
      </Group>
      {/* macOS has the app menu's About panel; elsewhere it is here. */}
      {isMac ? null : (
        <p className="text-muted-foreground px-1 text-xs">
          Inset Shelf {view.version}. A prototype for the Inset capture
          experiments.
        </p>
      )}
    </main>
  );
};

export const SettingsApp = () => {
  const view = usePushedView<SettingsView | null>(load, subscribe, null);

  return view === null ? null : <SettingsForm view={view} />;
};
