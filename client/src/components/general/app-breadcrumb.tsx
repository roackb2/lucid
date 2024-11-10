import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Link, useRouterState } from '@tanstack/react-router'
import { capitalize } from "lodash-es"

export default function AppBreadcrumb() {
  const router = useRouterState();

  const paths = router.location.pathname.split('/').slice(1)

  const capitalizePath = (path: string) => {
    return capitalize(path.replace(/-/g, ' '))
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {paths.map((path, index) => (
          <div key={path} className="flex flex-row items-center gap-2">
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {index === paths.length - 1 ? (
                <Link to={`/${paths.slice(0, index + 1).join('/')}`}>{capitalizePath(path)}</Link>
              ) : (
                <BreadcrumbPage>{capitalizePath(path)}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </div>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
