#if UNITY_EDITOR
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using VRC.SDKBase;

namespace UnderWeb.Media.Editor
{
    /// <summary>
    /// One click: fills in every poster slot's image addresses and the world manifest
    /// address from your media host + world id. Run it after adding or renaming slots.
    /// </summary>
    public class UnderWebMediaBaker : EditorWindow
    {
        private const string PrefBase = "UnderWebMedia.BaseUrl";
        private const string PrefSlug = "UnderWebMedia.WorldSlug.";
        private static readonly Regex KeyRule = new Regex("^[A-Z0-9][A-Z0-9_]{1,47}$");
        private static readonly Regex SlugRule = new Regex("^[a-z0-9][a-z0-9-]{1,40}$");

        private string _baseUrl;
        private string _slug;
        private Vector2 _scroll;
        private string _report = "";

        [MenuItem("Tools/UnderWeb/Bake Media URLs")]
        public static void Open() => GetWindow<UnderWebMediaBaker>("UnderWeb Media");

        private string SceneKey => PrefSlug + EditorSceneManager.GetActiveScene().path;

        private void OnEnable()
        {
            _baseUrl = EditorPrefs.GetString(PrefBase, "https://YOURNAME.github.io/underweb-media");
            _slug = EditorPrefs.GetString(SceneKey, "");
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField("UnderWeb World Media", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Media host = your GitHub Pages address (shown on underweb.cloud → World Media Manager).\n" +
                "World id = the short id you gave this world there (e.g. hub).",
                MessageType.Info);
            _baseUrl = EditorGUILayout.TextField("Media host", _baseUrl).Trim().TrimEnd('/');
            _slug = EditorGUILayout.TextField("World id", _slug).Trim().ToLowerInvariant();

            var slots = FindSlots();
            EditorGUILayout.Space();
            EditorGUILayout.LabelField($"Slots in this scene: {slots.Count}");
            _scroll = EditorGUILayout.BeginScrollView(_scroll, GUILayout.MaxHeight(180));
            foreach (var s in slots)
            {
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.ObjectField(s, typeof(UnderWebMediaSlot), true);
                EditorGUILayout.LabelField(s.slotKey + (s.gallerySize > 1 ? $" ×{s.gallerySize}" : ""), GUILayout.Width(200));
                EditorGUILayout.EndHorizontal();
            }
            EditorGUILayout.EndScrollView();

            using (new EditorGUI.DisabledScope(slots.Count == 0))
            {
                if (GUILayout.Button("Bake media URLs", GUILayout.Height(32))) Bake(slots);
            }
            if (!string.IsNullOrEmpty(_report)) EditorGUILayout.HelpBox(_report, MessageType.None);
        }

        private static List<UnderWebMediaSlot> FindSlots() =>
            Resources.FindObjectsOfTypeAll<UnderWebMediaSlot>()
                .Where(s => s != null && s.gameObject.scene.IsValid() && !EditorUtility.IsPersistent(s))
                .OrderBy(s => s.slotKey)
                .ToList();

        private void Bake(List<UnderWebMediaSlot> slots)
        {
            if (!_baseUrl.StartsWith("https://") || !_baseUrl.Contains(".github.io"))
            {
                if (!EditorUtility.DisplayDialog("Media host isn't on github.io",
                        "VRChat only loads images from allow-listed hosts for most players. *.github.io is allowed; other hosts need players to enable 'Allow Untrusted URLs'. Bake anyway?",
                        "Bake anyway", "Cancel")) return;
            }
            if (!SlugRule.IsMatch(_slug))
            {
                EditorUtility.DisplayDialog("World id", "Use the short world id from the website: lowercase letters, numbers and dashes.", "OK");
                return;
            }

            var problems = new List<string>();
            var dupes = slots.GroupBy(s => s.slotKey).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
            foreach (var d in dupes) problems.Add($"Slot ID {d} is used more than once — each poster needs its own ID.");
            foreach (var s in slots.Where(s => !KeyRule.IsMatch(s.slotKey ?? ""))) problems.Add($"\"{s.slotKey}\" on {s.name}: use CAPITALS, numbers and _ (e.g. EVENT_BOARD_01).");
            foreach (var s in slots.Where(s => s.targetRenderer == null)) problems.Add($"{s.slotKey}: no Target Renderer set.");
            if (problems.Count > 0 && !EditorUtility.DisplayDialog("Fix these first?", string.Join("\n", problems), "Bake anyway", "Cancel")) return;

            EditorPrefs.SetString(PrefBase, _baseUrl);
            EditorPrefs.SetString(SceneKey, _slug);

            int urlCount = 0;
            foreach (var s in slots)
            {
                Undo.RecordObject(s, "Bake UnderWeb media URLs");
                int n = Mathf.Clamp(s.gallerySize, 1, 20);
                s.urls = new VRCUrl[n];
                for (int i = 0; i < n; i++)
                {
                    s.urls[i] = new VRCUrl($"{_baseUrl}/w/{_slug}/{s.slotKey}/{i + 1}.jpg");
                    urlCount++;
                }
                EditorUtility.SetDirty(s);
                PrefabUtility.RecordPrefabInstancePropertyModifications(s);
            }

            var world = Resources.FindObjectsOfTypeAll<UnderWebMediaWorld>().FirstOrDefault(w => w.gameObject.scene.IsValid() && !EditorUtility.IsPersistent(w));
            if (world == null)
            {
                var go = new GameObject("UnderWeb Media");
                Undo.RegisterCreatedObjectUndo(go, "Create UnderWeb Media");
                world = go.AddComponent<UnderWebMediaWorld>();
            }
            Undo.RecordObject(world, "Bake UnderWeb media URLs");
            world.manifestUrl = new VRCUrl($"{_baseUrl}/w/{_slug}/manifest.json");
            world.slots = slots.ToArray();
            EditorUtility.SetDirty(world);
            PrefabUtility.RecordPrefabInstancePropertyModifications(world);
            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());

            int downloads = urlCount + 1;
            _report = $"Baked {slots.Count} slots ({urlCount} image addresses) for world \"{_slug}\".\n" +
                      $"Players download {downloads} files on join; at VRChat's 1 per 5 seconds that's about {downloads * 5}s to load everything.\n" +
                      "Add the same Slot IDs on the website, publish, then upload the world once.";
            if (problems.Count > 0) _report += "\nWarnings:\n" + string.Join("\n", problems);
            Debug.Log("[UnderWebMedia] " + _report);
        }
    }
}
#endif
