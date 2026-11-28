import { Button } from "@inset/ui/components/button";
import { cn } from "@inset/ui/lib/utils";
import type { PrivacyPane, SettingsView } from "@shared/settings";
import { useEffect, useId, useRef } from "react";
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
import { settingsBridge } from "@/shared/bridge";
import { isMac, isWindows } from "@/shared/platform";
import { usePushedView } from "@/shared/use-pushed-view";
import { WindowHeader, WindowTitle } from "@/shared/window-header";

const api = settingsBridge();

/** The range the fitHeight message accepts (see the settings contract). */
const MIN_REPORTED_HEIGHT = 120;
const MAX_REPORTED_HEIGHT = 4000;

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

/** A settings row, padded like an item on the shelf: the label on the left, its control on the right, an optional note below. */
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
  <div className="flex min-h-12 flex-col justify-center gap-1 px-3 py-2.5">
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={labelFor}>{label}</Label>
      {children}
    </div>
    {note === undefined ? null : (
      <p className="text-muted-foreground pr-12 text-xs leading-snug">{note}</p>
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
  <section className="flex flex-col gap-1">
    <h2 className="text-muted-foreground flex h-7 items-center px-1.5 text-xs font-medium">
      {title}
    </h2>
    <div className="bg-background/60 border-foreground/10 divide-foreground/10 flex flex-col divide-y rounded-lg border">
      {children}
    </div>
  </section>
);

/** A line of the privacy section: what the app is allowed to reach, why, and where to change it. */
const AccessRow = ({
  children,
  pane,
  title,
}: {
  readonly title: string;
  readonly children: ReactNode;
  /** The System Settings pane to open (macOS only). */
  readonly pane?: PrivacyPane;
}) => (
  <div className="flex min-h-12 items-center justify-between gap-4 px-3 py-2.5">
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-xs leading-snug">{children}</p>
    </div>
    {isMac && pane !== undefined ? (
      <Button
        className="shrink-0"
        onClick={() => {
          api.openPane(pane);
        }}
        size="sm"
        variant="outline"
      >
        Open
      </Button>
    ) : null}
  </div>
);

const SettingsForm = ({ view }: { readonly view: SettingsView }) => {
  const loginId = useId();
  const iconId = useId();
  const copyId = useId();
  const shotId = useId();
  const tipsId = useId();
  const chatId = useId();
  const { settings } = view;
  const header = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  // The window takes the page's natural height, so it has no empty space below the last
  // group. The main process limits it to the screen; the groups then scroll under the header.
  useEffect(() => {
    const element = content.current;

    const observer = new ResizeObserver(() => {
      if (element !== null) {
        const natural =
          (header.current?.getBoundingClientRect().height ?? 0) +
          element.getBoundingClientRect().height;

        api.fitHeight(
          Math.min(
            MAX_REPORTED_HEIGHT,
            Math.max(MIN_REPORTED_HEIGHT, Math.ceil(natural))
          )
        );
      }
    });

    if (element !== null) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <main
      className={cn(
        "text-foreground flex h-screen flex-col",
        // On macOS the window's translucent material shows through, as in the shelf.
        !isMac && "bg-background"
      )}
    >
      {/* macOS and Windows draw no title bar: the header names and moves the window, as in the drawing window. */}
      {isMac || isWindows ? (
        <div className="shrink-0" ref={header}>
          <WindowHeader>
            <WindowTitle>Settings</WindowTitle>
          </WindowHeader>
        </div>
      ) : (
        <h1 className="sr-only">Settings</h1>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3" ref={content}>
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
                    <SelectItem value="menuBar">
                      {ICON_LABELS.menuBar}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Row>
            ) : null}
          </Group>
          {/* Screenshots are watched on macOS and Windows. */}
          {isMac || isWindows ? (
            <Group title="Screenshots">
              <Row
                label="Show new screenshots"
                labelFor={shotId}
                note="A card beside the shelf lets you add, copy, annotate or drag each new screenshot."
              >
                <Switch
                  checked={settings.screenshotCards}
                  id={shotId}
                  onCheckedChange={(checked) => {
                    api.update({ screenshotCards: checked });
                  }}
                />
              </Row>
            </Group>
          ) : null}
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
          <Group title="Privacy & permissions">
            {isMac ? (
              <>
                <AccessRow pane="accessibility" title="Accessibility">
                  Double Shift sees which key you press (only Shift is acted on;
                  nothing else is stored), copies your selection and reads the
                  window’s page address.
                </AccessRow>
                <AccessRow pane="screen" title="Screen Recording">
                  Window titles and window links. Pictures of other windows are
                  used only in the window picker.
                </AccessRow>
                <AccessRow pane="automation" title="Automation (Apple Events)">
                  Asks Safari, Chrome and other browsers for the page address of
                  the window an item came from.
                </AccessRow>
                <AccessRow pane="files" title="Desktop and Documents folders">
                  Screenshot cards, if on, watch the screenshot folder when it
                  is on your Desktop or in Documents.
                </AccessRow>
              </>
            ) : null}
            <AccessRow title="Clipboard">
              Double Shift copies your selection and puts your clipboard back.
              Items a password manager marks as private are never read, kept or
              rewritten.
              {isMac
                ? " Screenshot cards, if on, watch it for new screenshots."
                : ""}
            </AccessRow>
            <Row
              label="Look up chat titles and links"
              labelFor={chatId}
              note="Reads ~/.codex/session_index.jsonl (ChatGPT desktop) and T3 Code’s database in ~/.t3/userdata to name a chat and reopen it. Nothing else in those apps is read, and nothing is sent anywhere. Off by default."
            >
              <Switch
                checked={settings.chatLookups}
                id={chatId}
                onCheckedChange={(checked) => {
                  api.update({ chatLookups: checked });
                }}
              />
            </Row>
            <AccessRow title="Open at Login">
              Only if you turn it on under General.
            </AccessRow>
            <AccessRow title="Network">
              Inset Shelf contacts the network only when you check for updates:
              GitHub Releases. No telemetry, analytics or crash reports.
            </AccessRow>
            <div className="flex min-h-12 items-center justify-between gap-4 px-3 py-2.5">
              <p className="text-muted-foreground text-xs leading-snug">
                Everything you capture is stored as plain files on this
                computer.
              </p>
              <Button
                className="shrink-0"
                onClick={() => {
                  api.showDataFolder();
                }}
                size="sm"
                variant="outline"
              >
                Show Data Folder
              </Button>
            </div>
          </Group>
          <Group title="Tips">
            <Row
              label="Show tips"
              labelFor={tipsId}
              note="A short tip beside a control the first time you meet it."
            >
              <Switch
                checked={view.tips}
                id={tipsId}
                onCheckedChange={(checked) => {
                  api.setTips(checked);
                }}
              />
            </Row>
            <div className="flex min-h-12 items-center justify-between gap-4 px-3 py-2.5">
              <p className="text-muted-foreground text-xs leading-snug">
                Getting started and every tip start over.
              </p>
              <Button
                onClick={() => {
                  api.resetTutorial();
                }}
                size="sm"
                variant="outline"
              >
                Reset Tutorial
              </Button>
            </div>
          </Group>
          {/* macOS has the app menu's About panel; elsewhere it is here. */}
          {isMac ? null : (
            <p className="text-muted-foreground px-1 text-xs">
              Inset Shelf {view.version}. A prototype for the Inset capture
              experiments.
            </p>
          )}
        </div>
      </div>
    </main>
  );
};

export const SettingsApp = () => {
  const view = usePushedView<SettingsView | null>(load, subscribe, null);

  return view === null ? null : <SettingsForm view={view} />;
};
