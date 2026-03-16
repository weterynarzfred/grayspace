import * as Select from "@radix-ui/react-select";
import { PANEL_TYPES } from "./panelTypes";
import styles from "./PanelTypeSwitcher.module.scss";

function PanelTypeSwitcher({ panelType, onPanelTypeChange }) {
  return (
    <Select.Root value={panelType} onValueChange={onPanelTypeChange}>
      <Select.Trigger className={styles.trigger} aria-label="Panel type switcher">
        <Select.Value />
        <Select.Icon className={styles.icon}>v</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className={styles.content} position="popper" sideOffset={6}>
          <Select.Viewport className={styles.viewport}>
            {PANEL_TYPES.map((panelTypeOption) => (
              <Select.Item
                key={panelTypeOption.value}
                className={styles.item}
                value={panelTypeOption.value}
              >
                <Select.ItemText>{panelTypeOption.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export default PanelTypeSwitcher;
