using UdonSharp;
using UnityEngine;
using VRC.SDK3.Data;
using VRC.SDK3.StringLoading;
using VRC.SDKBase;
using VRC.Udon.Common.Interfaces;

namespace UnderWeb.Media
{
    /// <summary>
    /// One per world. Downloads the world's manifest from the media host (which images
    /// are active in each gallery, rotation speed) and refreshes every slot on a timer,
    /// so posters published on underweb.cloud show up for people already in the world.
    ///
    /// Notes on VRChat limits this is built around:
    ///  - String and image downloads are rate limited (one every 5 seconds per world),
    ///    so keep refreshMinutes sensible (10+). Requests over the limit queue up.
    ///  - The host (GitHub Pages) caches files for ~10 minutes, so refreshing more
    ///    often than that doesn't make updates arrive faster.
    /// </summary>
    [UdonBehaviourSyncMode(BehaviourSyncMode.None)]
    public class UnderWebMediaWorld : UdonSharpBehaviour
    {
        [Header("Baked by Tools → UnderWeb → Bake Media URLs")]
        public VRCUrl manifestUrl;
        public UnderWebMediaSlot[] slots;

        [Header("Filled from the manifest (read-only)")]
        [Tooltip("The manifest's optional top-level \"names\" list (e.g. everyone with work in the world).")]
        public string[] names = new string[0];
        [Tooltip("Goes up by one every time the manifest loads, so other scripts can tell it changed.")]
        public int manifestVersion;

        [Tooltip("How often people already in the world re-check for new posters. 0 = only on join.")]
        [Range(0f, 120f)] public float refreshMinutes = 15f;

        private void Start()
        {
            LoadManifest();
            if (refreshMinutes > 0f) SendCustomEventDelayedSeconds(nameof(_RefreshTick), refreshMinutes * 60f);
        }

        public void _RefreshTick()
        {
            LoadManifest();
            for (int i = 0; i < slots.Length; i++)
            {
                if (slots[i] != null) slots[i].Refresh();
            }
            if (refreshMinutes > 0f) SendCustomEventDelayedSeconds(nameof(_RefreshTick), refreshMinutes * 60f);
        }

        private void LoadManifest()
        {
            if (manifestUrl == null || string.IsNullOrEmpty(manifestUrl.Get())) return;
            VRCStringDownloader.LoadUrl(manifestUrl, (IUdonEventReceiver)this);
        }

        public override void OnStringLoadSuccess(IVRCStringDownload result)
        {
            if (!VRCJson.TryDeserializeFromJson(result.Result, out DataToken root) || root.TokenType != TokenType.DataDictionary)
            {
                Debug.LogWarning("[UnderWebMedia] Manifest isn't valid JSON; slots keep their current images.");
                return;
            }
            if (root.DataDictionary.TryGetValue("names", TokenType.DataList, out DataToken namesTok))
            {
                DataList nl = namesTok.DataList;
                int nn = 0;
                string[] got = new string[Mathf.Min(nl.Count, 500)];
                for (int j = 0; j < got.Length; j++) if (nl.TryGetValue(j, TokenType.String, out DataToken s)) got[nn++] = s.String;
                names = new string[nn];
                for (int j = 0; j < nn; j++) names[j] = got[j];
            }
            manifestVersion++;
            if (!root.DataDictionary.TryGetValue("slots", TokenType.DataDictionary, out DataToken slotMap)) return;

            for (int i = 0; i < slots.Length; i++)
            {
                UnderWebMediaSlot slot = slots[i];
                if (slot == null) continue;
                if (!slotMap.DataDictionary.TryGetValue(slot.slotKey, TokenType.DataDictionary, out DataToken entry))
                {
                    // Not on the website (yet): leave the slot alone rather than blanking it.
                    continue;
                }
                float rotate = 0f;
                if (entry.DataDictionary.TryGetValue("rotate", TokenType.Double, out DataToken rotTok)) rotate = (float)rotTok.Double;

                int[] positions = new int[20];
                int count = 0;
                if (entry.DataDictionary.TryGetValue("active", TokenType.DataList, out DataToken activeTok))
                {
                    DataList list = activeTok.DataList;
                    for (int j = 0; j < list.Count && count < 20; j++)
                    {
                        if (list.TryGetValue(j, TokenType.Double, out DataToken n)) positions[count++] = (int)n.Double;
                    }
                }
                // optional per-position extras: "ids" (strings) and "likes" (numbers), index 0 = position 1
                int size = Mathf.Max(1, slot.gallerySize);
                string[] ids = new string[size];
                int[] likes = new int[size];
                if (entry.DataDictionary.TryGetValue("ids", TokenType.DataList, out DataToken idsTok))
                {
                    DataList il = idsTok.DataList;
                    for (int j = 0; j < il.Count && j < size; j++) if (il.TryGetValue(j, TokenType.String, out DataToken t)) ids[j] = t.String;
                }
                if (entry.DataDictionary.TryGetValue("likes", TokenType.DataList, out DataToken likesTok))
                {
                    DataList ll = likesTok.DataList;
                    for (int j = 0; j < ll.Count && j < size; j++) if (ll.TryGetValue(j, TokenType.Double, out DataToken t)) likes[j] = (int)t.Double;
                }
                slot.ApplyExtras(ids, likes);
                slot.ApplyManifest(positions, count, rotate);
            }
        }

        public override void OnStringLoadError(IVRCStringDownload result)
        {
            // No manifest yet (nothing published) or the host is down: slots still try their images.
            Debug.LogWarning($"[UnderWebMedia] Manifest not loaded ({result.ErrorCode}): {result.Error}");
        }
    }
}
