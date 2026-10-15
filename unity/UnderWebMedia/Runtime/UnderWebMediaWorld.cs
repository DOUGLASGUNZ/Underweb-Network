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
