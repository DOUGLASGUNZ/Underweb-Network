#if UNITY_EDITOR
using System.IO;
using UdonSharp;
using UnityEditor;
using UnityEngine;

namespace UnderWeb.Media.Editor
{
    /// <summary>
    /// One click: makes sure both UnderWeb media scripts have their UdonSharp program
    /// assets (UdonSharp needs one per script before the component can be added).
    /// </summary>
    public static class UnderWebMediaSetup
    {
        [MenuItem("Tools/UnderWeb/Set Up Media Scripts")]
        public static void Setup()
        {
            int created = 0;
            foreach (var type in new[] { typeof(UnderWebMediaSlot), typeof(UnderWebMediaWorld) })
            {
                string[] guids = AssetDatabase.FindAssets($"{type.Name} t:MonoScript");
                MonoScript script = null;
                string scriptPath = null;
                foreach (var g in guids)
                {
                    var p = AssetDatabase.GUIDToAssetPath(g);
                    var s = AssetDatabase.LoadAssetAtPath<MonoScript>(p);
                    if (s != null && s.GetClass() == type) { script = s; scriptPath = p; break; }
                }
                if (script == null) { Debug.LogError($"[UnderWebMedia] Couldn't find {type.Name}.cs"); continue; }

                string assetPath = Path.ChangeExtension(scriptPath, ".asset");
                if (AssetDatabase.LoadAssetAtPath<UdonSharpProgramAsset>(assetPath) != null) continue;
                var programAsset = ScriptableObject.CreateInstance<UdonSharpProgramAsset>();
                programAsset.sourceCsScript = script;
                AssetDatabase.CreateAsset(programAsset, assetPath);
                created++;
            }
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(); // UdonSharp compiles the new program assets on refresh
            EditorUtility.DisplayDialog("UnderWeb Media", created > 0 ? $"Created {created} program asset(s). You can now add UnderWeb Media Slot to posters." : "Already set up.", "OK");
        }
    }
}
#endif
