
(function(){
  const tabs = Array.from(document.querySelectorAll('[data-experience-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-experience-panel]'));
  const addonPanels = Array.from(document.querySelectorAll('[data-experience-addons]'));

  function selectExperience(key, updateHash = true){
    tabs.forEach(tab => {
      const active = tab.dataset.experienceTab === key;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    panels.forEach(panel => {
      const active = panel.dataset.experiencePanel === key;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });

    addonPanels.forEach(panel => {
      const active = panel.dataset.experienceAddons === key;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });

    if(updateHash && history.replaceState){
      history.replaceState(null, '', '#experience-' + key);
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => selectExperience(tab.dataset.experienceTab));
  });

  const hashMatch = location.hash.match(/^#experience-(glam|360|vogue|audio)$/);
  selectExperience(hashMatch ? hashMatch[1] : 'glam', false);
})();
