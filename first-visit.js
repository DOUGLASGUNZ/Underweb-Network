/* Delegated controls for dynamic, genuine empty states. Existing auth and
   navigation handlers are left unchanged. */
document.addEventListener('click', function (event) {
  const clear = event.target.closest('[data-uw-clear-creators]');
  if (!clear) return;
  const defaults = {
    creatorSearch: '',
    creatorCommunity: 'all',
    creatorDiscipline: 'All Disciplines',
    creatorAvailability: 'Any Availability'
  };
  Object.entries(defaults).forEach(function ([id, value]) {
    const field = document.getElementById(id);
    if (field) {
      field.value = value;
      field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    }
  });
  // The upstream site replaces renderCreatorDirectory with its canonical
  // role-gated renderer. Prefer that renderer so cleared results stay real.
  if (typeof uw758Render === 'function') uw758Render();
  else if (typeof renderCreatorDirectory === 'function') renderCreatorDirectory();
});

// The existing post-project handler opens the real publisher for members, but
// only toasts for guests. Send guests through the existing Join action instead.
document.addEventListener('click', function (event) {
  const post = event.target.closest('.uw63-empty [data-action="post-project"]');
  if (!post || (typeof currentSession !== 'undefined' && currentSession)) return;
  event.stopImmediatePropagation();
  document.querySelector('header [data-action="join"]')?.click();
}, true);