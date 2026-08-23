import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { MonoText } from './Text';
import { colors, radii } from '../../theme/tokens';

export type DropdownOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  accent?: boolean;
};

// Chip + absolute menu, ported from the pattern the Log screen originally used for
// its single-select level filter (now multi-select there — see LogScreen.tsx) and
// reused here for Settings rows that pick one value from a small fixed set (M6).
export function Dropdown<T extends string>({ value, options, onChange, accent }: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View>
      <TouchableOpacity style={styles.chip} onPress={() => setOpen((o) => !o)}>
        <MonoText style={[styles.chipLabel, accent && styles.chipLabelAccent]}>
          {selected?.label ?? value} ▾
        </MonoText>
      </TouchableOpacity>
      {open && (
        <View style={styles.menu}>
          {options.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={styles.menuItem}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <MonoText style={[styles.menuLabel, option.value === value && styles.menuLabelActive]}>
                {option.label}
              </MonoText>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 2,
  },
  chipLabel: {
    fontSize: 12,
    color: colors.text,
  },
  chipLabelAccent: {
    color: colors.accent,
    fontWeight: '700',
  },
  menu: {
    position: 'absolute',
    top: 22,
    right: 0,
    backgroundColor: colors.bgSheet,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 4,
    minWidth: 130,
    zIndex: 20,
  },
  menuItem: { paddingVertical: 8, paddingHorizontal: 12 },
  menuLabel: { fontSize: 12, color: colors.text },
  menuLabelActive: { color: colors.accent, fontWeight: '700' },
});
