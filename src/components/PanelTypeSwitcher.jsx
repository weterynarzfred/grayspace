import * as Select from "@radix-ui/react-select";
import { PANEL_TYPES } from "./panelTypes";
import styles from "./PanelTypeSwitcher.module.scss";

function PanelTypeSwitcher({ panelType, onPanelTypeChange }) {
  return <Select.Root value={panelType} onValueChange={onPanelTypeChange}>
    <Select.Trigger className={styles.trigger} aria-label="Panel type switcher">
      <Select.Value />
      <Select.Icon className={styles.icon}>
        <svg viewBox="0 0 10 10">
          <path d="M1 3L5 7L9 3" />
        </svg>
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className={styles.content} collisionPadding={0} position="popper">
        <Select.Viewport className={styles.viewport} >
          {PANEL_TYPES.map(panelTypeOption => <Select.Item
            key={panelTypeOption.value}
            className={styles.item}
            value={panelTypeOption.value}
          >
            <Select.ItemText>{panelTypeOption.label}</Select.ItemText>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}

export default PanelTypeSwitcher;
