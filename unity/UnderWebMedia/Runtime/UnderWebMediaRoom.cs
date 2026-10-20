using UdonSharp;
using UnityEngine;
using VRC.SDKBase;

namespace UnderWeb.Media
{
    /// <summary>
    /// Load-on-enter for a room full of media slots. VRChat downloads one image every
    /// 5 seconds for the whole world, so a room of ~20 images shouldn't load for every
    /// player on join. Instead, when YOU walk into the room's box this asks its slots
    /// (which have Load On Enter ticked) for their images: first image of every slot in
    /// the order listed (put the most important first), then the rest of each gallery.
    /// A while after you leave, the slots drop their textures again.
    ///
    /// The room is a box (center + half size, in world space), checked once a second -
    /// no collider, so it never gets in the way of anything you click.
    /// </summary>
    [UdonBehaviourSyncMode(BehaviourSyncMode.None)]
    public class UnderWebMediaRoom : UdonSharpBehaviour
    {
        [Tooltip("Slots in load order. The first one listed loads first.")]
        public UnderWebMediaSlot[] slots;
        public Vector3 center;
        public Vector3 halfSize = new Vector3(8f, 3f, 6f);
        [Tooltip("Seconds after you leave before the textures are let go (coming straight back doesn't re-download).")]
        public float releaseAfterSeconds = 90f;

        private bool _inside, _loaded;
        private float _leftAt = -1f, _next;

        private void Update()
        {
            if (Time.time < _next) return;
            _next = Time.time + 1f;
            VRCPlayerApi me = Networking.LocalPlayer;
            if (!Utilities.IsValid(me)) return;
            Vector3 d = me.GetPosition() - center;
            bool inside = Mathf.Abs(d.x) <= halfSize.x && Mathf.Abs(d.y) <= halfSize.y && Mathf.Abs(d.z) <= halfSize.z;
            if (inside && !_inside) Entered();
            if (!inside && _inside) _leftAt = Time.time;
            _inside = inside;
            if (!_inside && _loaded && _leftAt >= 0f && Time.time - _leftAt > releaseAfterSeconds) Release();
        }

        private void Entered()
        {
            _leftAt = -1f;
            if (_loaded || slots == null) return;
            _loaded = true;
            for (int i = 0; i < slots.Length; i++) if (slots[i] != null) slots[i].LoadFirst();
            for (int i = 0; i < slots.Length; i++) if (slots[i] != null) slots[i].LoadRest();
        }

        private void Release()
        {
            _loaded = false; _leftAt = -1f;
            if (slots == null) return;
            for (int i = 0; i < slots.Length; i++) if (slots[i] != null) slots[i].Release();
        }
    }
}
