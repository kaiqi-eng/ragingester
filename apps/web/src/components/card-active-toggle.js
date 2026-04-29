export function getToggleActiveAction(active) {
  return {
    label: active ? 'Deactivate' : 'Activate',
    nextActive: !active
  };
}
