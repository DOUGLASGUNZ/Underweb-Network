// UnderWeb Court: a room button. Forwards its interaction to the bench with its action number.
// FICTIONAL ROLEPLAY ONLY. NOT COMPILED OR TESTED IN UNITY YET.

using UdonSharp;
using UnityEngine;

public class CourtButton : UdonSharpBehaviour
{
    public CourtBench bench;
    public int action;

    public override void Interact()
    {
        if (bench != null) bench.Press(action);
    }
}
