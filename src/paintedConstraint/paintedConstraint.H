/*---------------------------------------------------------------------------*\
    adjoint-paint: morphing-box constraint that adds the user's paint.

Class
    Foam::paintedConstraint

Description
    Same as the "none" morphing-box constraint (OpenFOAM's noConstraint),
    whose bounds keep every control point between the midpoints to its
    neighbours and move along each cycle (with nonOverlappingCPs and
    updateBounds), so the box cannot fold. On top of that, every bound is
    clipped to fixed, absolute bounds derived from the user's paint.
    Design variables whose paint bounds have zero width are not design
    variables at all (removed from the active set): they stay exactly where
    they are, and the optimiser does not have to carry them.

        constraintType    painted;
        paintLowerBounds  <3*nCPs values>;
        paintUpperBounds  <3*nCPs values>;

    written by tools/paint_to_bounds.py.

SourceFiles
    paintedConstraint.C

\*---------------------------------------------------------------------------*/

#ifndef paintedConstraint_H
#define paintedConstraint_H

#include "noConstraint.H"

namespace Foam
{

class paintedConstraint
:
    public noConstraint
{
    // Private data

        //- Fixed bounds from the paint, one per design variable
        scalarField paintLower_;
        scalarField paintUpper_;

        //- Whether the paint lets a design variable move at all
        boolList free_;


    // Private member functions

        //- Clip the given bounds to the paint bounds
        void clip
        (
            autoPtr<scalarField>& lowerBounds,
            autoPtr<scalarField>& upperBounds
        ) const;

        //- No copy construct or assignment
        paintedConstraint(const paintedConstraint&) = delete;
        void operator=(const paintedConstraint&) = delete;


public:

    TypeName("painted");

    paintedConstraint
    (
        const fvMesh& mesh,
        const dictionary& dict,
        volumetricBSplinesDesignVariables& designVariables
    );

    virtual ~paintedConstraint() = default;


    // Member functions

        //- Active design variables of noConstraint, minus the fixed ones
        virtual labelList computeActiveDesignVariables
        (
            const labelList& activeCPCoors
        );

        //- Initial bounds: those of noConstraint, clipped to the paint
        virtual void computeBounds
        (
            autoPtr<scalarField>& lowerBounds,
            autoPtr<scalarField>& upperBounds
        );

        //- Bounds after each cycle: those of noConstraint, clipped to the paint
        virtual void updateBounds
        (
            autoPtr<scalarField>& lowerBounds,
            autoPtr<scalarField>& upperBounds
        );
};

} // End namespace Foam

#endif
