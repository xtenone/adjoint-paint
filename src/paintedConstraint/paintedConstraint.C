/*---------------------------------------------------------------------------*\
    adjoint-paint: morphing-box constraint that adds the user's paint.
    See paintedConstraint.H.
\*---------------------------------------------------------------------------*/

#include "paintedConstraint.H"
#include "addToRunTimeSelectionTable.H"

namespace Foam
{
    defineTypeNameAndDebug(paintedConstraint, 0);
    addToRunTimeSelectionTable
    (
        morphingBoxConstraint,
        paintedConstraint,
        dictionary
    );
}


Foam::paintedConstraint::paintedConstraint
(
    const fvMesh& mesh,
    const dictionary& dict,
    volumetricBSplinesDesignVariables& designVariables
)
:
    noConstraint(mesh, dict, designVariables),
    paintLower_(dict.get<scalarField>("paintLowerBounds")),
    paintUpper_(dict.get<scalarField>("paintUpperBounds")),
    free_(paintLower_.size(), false)
{
    if (paintLower_.size() != paintUpper_.size())
    {
        FatalErrorInFunction
            << "paintLowerBounds and paintUpperBounds differ in size"
            << exit(FatalError);
    }
    label nFree(0);
    forAll(free_, i)
    {
        free_[i] = (paintUpper_[i] - paintLower_[i]) > SMALL;
        nFree += free_[i];
    }
    Info<< "Paint bounds for " << paintLower_.size()
        << " design variables, " << nFree << " of them free to move" << endl;
}


Foam::labelList Foam::paintedConstraint::computeActiveDesignVariables
(
    const labelList& activeCPCoors
)
{
    const labelList active
    (
        noConstraint::computeActiveDesignVariables(activeCPCoors)
    );
    DynamicList<label> kept(active.size());
    for (const label i : active)
    {
        if (i < free_.size() && free_[i])
        {
            kept.append(i);
        }
    }
    Info<< "Active design variables: " << kept.size() << " of "
        << active.size() << " (the rest is fixed by the paint)" << endl;
    return labelList(std::move(kept));
}


void Foam::paintedConstraint::clip
(
    autoPtr<scalarField>& lowerBounds,
    autoPtr<scalarField>& upperBounds
) const
{
    if (!lowerBounds || !upperBounds)
    {
        FatalErrorInFunction
            << "constraintType painted needs bounds to clip; "
            << "set nonOverlappingCPs true" << exit(FatalError);
    }
    if (lowerBounds().size() != paintLower_.size())
    {
        FatalErrorInFunction
            << "Paint bounds have " << paintLower_.size()
            << " values, the design variables " << lowerBounds().size()
            << exit(FatalError);
    }
    forAll(paintLower_, i)
    {
        // Fixed variables are inactive; their bounds are not used
        if (free_[i])
        {
            lowerBounds()[i] = max(lowerBounds()[i], paintLower_[i]);
            upperBounds()[i] = min(upperBounds()[i], paintUpper_[i]);
        }
    }
}


void Foam::paintedConstraint::computeBounds
(
    autoPtr<scalarField>& lowerBounds,
    autoPtr<scalarField>& upperBounds
)
{
    noConstraint::computeBounds(lowerBounds, upperBounds);
    clip(lowerBounds, upperBounds);
}


void Foam::paintedConstraint::updateBounds
(
    autoPtr<scalarField>& lowerBounds,
    autoPtr<scalarField>& upperBounds
)
{
    noConstraint::updateBounds(lowerBounds, upperBounds);
    clip(lowerBounds, upperBounds);
}
