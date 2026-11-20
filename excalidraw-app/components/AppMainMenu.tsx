import {
  loginIcon,
  ExcalLogo,
  eyeIcon,
  FreedrawIcon,
  TextIcon,
} from "@excalidraw/excalidraw/components/icons";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import {
  CaptureUpdateAction,
  MainMenu,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw/index";
import React from "react";

import { isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { isExcalidrawPlusSignedUser } from "../app_constants";

import {
  getHarnessRenderFlags,
  setHarnessRenderFlag,
  type HarnessToggleFlag,
} from "../harnessHost";

import { saveDebugState } from "./DebugCanvas";

/**
 * KuszCanvas: render-flag switch. Menu items mount each time the menu opens,
 * so reading the flag here (not in the memoised menu) shows the live value.
 */
const RenderFlagToggle = ({
  flag,
  icon,
  onChange,
  children,
}: {
  flag: HarnessToggleFlag;
  icon: React.ComponentProps<typeof MainMenu.ItemToggle>["icon"];
  onChange: (flag: HarnessToggleFlag, value: boolean) => void;
  children: React.ReactNode;
}) => (
  <MainMenu.ItemToggle
    icon={icon}
    checked={getHarnessRenderFlags()[flag]}
    onChange={(value) => onChange(flag, value)}
  >
    {children}
  </MainMenu.ItemToggle>
);

export const AppMainMenu: React.FC<{
  onCollabDialogOpen: () => any;
  isCollaborating: boolean;
  isCollabEnabled: boolean;
  theme: Theme | "system";
  refresh: () => void;
}> = React.memo((props) => {
  const { t } = useI18n();
  const excalidrawAPI = useExcalidrawAPI();
  // KuszCanvas: render flags change how elements draw, not the elements, so
  // re-send the scene without an undo step to redraw it
  const setRenderFlag = (key: HarnessToggleFlag, value: boolean) => {
    setHarnessRenderFlag(key, value);
    excalidrawAPI?.updateScene({
      elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };
  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      {props.isCollabEnabled && (
        <MainMenu.DefaultItems.LiveCollaborationTrigger
          isCollaborating={props.isCollaborating}
          onSelect={() => props.onCollabDialogOpen()}
        />
      )}
      <MainMenu.DefaultItems.CommandPalette className="highlighted" />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.ItemLink
        icon={ExcalLogo}
        href={`${
          import.meta.env.VITE_APP_PLUS_LP
        }/plus?utm_source=excalidraw&utm_medium=app&utm_content=hamburger`}
        className=""
      >
        Excalidraw+
      </MainMenu.ItemLink>
      <MainMenu.DefaultItems.Socials />
      <MainMenu.ItemLink
        icon={loginIcon}
        href={`${import.meta.env.VITE_APP_PLUS_APP}${
          isExcalidrawPlusSignedUser ? "" : "/sign-up"
        }?utm_source=signin&utm_medium=app&utm_content=hamburger`}
        className="highlighted"
      >
        {isExcalidrawPlusSignedUser ? t("labels.signIn") : t("labels.signUp")}
      </MainMenu.ItemLink>
      {isDevEnv() && (
        <MainMenu.Item
          icon={eyeIcon}
          onSelect={() => {
            if (window.visualDebug) {
              delete window.visualDebug;
              saveDebugState({ enabled: false });
            } else {
              window.visualDebug = { data: [] };
              saveDebugState({ enabled: true });
            }
            props?.refresh();
          }}
        >
          Visual Debug
        </MainMenu.Item>
      )}
      <MainMenu.Separator />
      <MainMenu.DefaultItems.Preferences />
      <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={props.theme} />
      <RenderFlagToggle
        flag="blackboard"
        icon={FreedrawIcon}
        onChange={setRenderFlag}
      >
        Blackboard mode
      </RenderFlagToggle>
      <RenderFlagToggle
        flag="markdown"
        icon={TextIcon}
        onChange={setRenderFlag}
      >
        Render Markdown
      </RenderFlagToggle>
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
});
