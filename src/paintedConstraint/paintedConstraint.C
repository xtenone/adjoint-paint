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
    paintUpper_(dict.get<scalarField>("paintUpperBounds"))
{
    if (paintLower_.size() != paintUpper_.size())
    {
        FatalErrorInFunction
            << "paintLowerBounds and paintUpperBounds differ in size"
            << exit(FatalError);
    }
    Info<< "Paint bounds for " << paintLower_.size()
        << " design variables" << endl;
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
        lowerBounds()[i] = max(lowerBounds()[i], paintLower_[i]);
        upperBounds()[i] = min(upperBounds()[i], paintUpper_[i]);
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
